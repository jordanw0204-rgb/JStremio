use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    marker::PhantomData,
    path::{Path, PathBuf},
    sync::Mutex,
};
use thiserror::Error;
use uuid::Uuid;

pub const DEFAULT_MAX_DOCUMENT_BYTES: u64 = 8 * 1024 * 1024;

pub trait StoredDocument: Clone + Default + DeserializeOwned + Serialize {
    const SCHEMA_VERSION: u32;

    fn schema_version(&self) -> u32;
    fn validate(&self) -> Result<(), StorageError>;
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage operation is unavailable")]
    Busy,
    #[error("{operation} failed: {source}")]
    Io {
        operation: &'static str,
        #[source]
        source: io::Error,
    },
    #[error("the data file exceeds the {limit} byte limit")]
    TooLarge { limit: u64 },
    #[error("the data file contains malformed JSON")]
    Malformed,
    #[error("schema version {found} is unsupported; expected {expected}")]
    UnsupportedSchema { found: u32, expected: u32 },
    #[error("invalid {field}: {message}")]
    Invalid {
        field: &'static str,
        message: String,
    },
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl StorageError {
    pub fn invalid(field: &'static str, message: impl Into<String>) -> Self {
        Self::Invalid {
            field,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Busy => "storage_busy",
            Self::Io { .. } => "storage_io",
            Self::TooLarge { .. } => "storage_too_large",
            Self::Malformed => "storage_malformed",
            Self::UnsupportedSchema { .. } => "unsupported_schema",
            Self::Invalid { .. } => "validation_failed",
            Self::Serialization(_) => "serialization_failed",
        }
    }
}

pub struct JsonStore<D: StoredDocument> {
    path: PathBuf,
    max_bytes: u64,
    gate: Mutex<()>,
    marker: PhantomData<D>,
}

impl<D: StoredDocument> JsonStore<D> {
    pub fn new(path: PathBuf) -> Self {
        Self::with_max_bytes(path, DEFAULT_MAX_DOCUMENT_BYTES)
    }

    pub fn with_max_bytes(path: PathBuf, max_bytes: u64) -> Self {
        Self {
            path,
            max_bytes,
            gate: Mutex::new(()),
            marker: PhantomData,
        }
    }

    pub fn read(&self) -> Result<D, StorageError> {
        let _guard = self.gate.lock().map_err(|_| StorageError::Busy)?;
        self.read_unlocked().map(|(document, _)| document)
    }

    pub fn mutate<R>(
        &self,
        mutation: impl FnOnce(&mut D) -> Result<R, StorageError>,
    ) -> Result<R, StorageError> {
        let _guard = self.gate.lock().map_err(|_| StorageError::Busy)?;
        let (mut document, previous_bytes) = self.read_unlocked()?;
        let result = mutation(&mut document)?;
        document.validate()?;
        self.write_unlocked(&document, previous_bytes.as_deref())?;
        Ok(result)
    }

    /// Applies a privacy-sensitive mutation without retaining the previous
    /// document in the recovery backup. The primary file is committed first,
    /// then any existing backup is removed while the store lock is held.
    pub fn mutate_and_purge_backup<R>(
        &self,
        mutation: impl FnOnce(&mut D) -> Result<R, StorageError>,
    ) -> Result<R, StorageError> {
        let _guard = self.gate.lock().map_err(|_| StorageError::Busy)?;
        let (mut document, _) = self.read_unlocked()?;
        let result = mutation(&mut document)?;
        document.validate()?;
        self.write_unlocked(&document, None)?;
        let backup = backup_path(&self.path);
        match fs::remove_file(backup) {
            Ok(()) => {}
            Err(source) if source.kind() == io::ErrorKind::NotFound => {}
            Err(source) => {
                return Err(StorageError::Io {
                    operation: "removing the private data backup",
                    source,
                });
            }
        }
        Ok(result)
    }

    fn read_unlocked(&self) -> Result<(D, Option<Vec<u8>>), StorageError> {
        if !self.path.exists() {
            let document = D::default();
            document.validate()?;
            return Ok((document, None));
        }

        let metadata = fs::metadata(&self.path).map_err(|source| StorageError::Io {
            operation: "reading data metadata",
            source,
        })?;
        if metadata.len() > self.max_bytes {
            return Err(StorageError::TooLarge {
                limit: self.max_bytes,
            });
        }

        let file = File::open(&self.path).map_err(|source| StorageError::Io {
            operation: "opening data",
            source,
        })?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(self.max_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|source| StorageError::Io {
                operation: "reading data",
                source,
            })?;
        if bytes.len() as u64 > self.max_bytes {
            return Err(StorageError::TooLarge {
                limit: self.max_bytes,
            });
        }

        let document: D = serde_json::from_slice(&bytes).map_err(|_| StorageError::Malformed)?;
        if document.schema_version() != D::SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema {
                found: document.schema_version(),
                expected: D::SCHEMA_VERSION,
            });
        }
        document.validate()?;
        Ok((document, Some(bytes)))
    }

    fn write_unlocked(
        &self,
        document: &D,
        previous_bytes: Option<&[u8]>,
    ) -> Result<(), StorageError> {
        let parent = self.path.parent().ok_or_else(|| {
            StorageError::invalid("path", "the fixed data file has no parent directory")
        })?;
        fs::create_dir_all(parent).map_err(|source| StorageError::Io {
            operation: "creating the data directory",
            source,
        })?;

        if let Some(previous_bytes) = previous_bytes {
            let backup = backup_path(&self.path);
            write_atomic_bytes(&backup, previous_bytes)?;
        }

        let mut bytes = serde_json::to_vec_pretty(document)?;
        bytes.push(b'\n');
        if bytes.len() as u64 > self.max_bytes {
            return Err(StorageError::TooLarge {
                limit: self.max_bytes,
            });
        }
        write_atomic_bytes(&self.path, &bytes)
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

fn write_atomic_bytes(destination: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let parent = destination.parent().ok_or_else(|| {
        StorageError::invalid("path", "the fixed data file has no parent directory")
    })?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| StorageError::invalid("path", "the fixed data filename is invalid"))?;
    let temporary = parent.join(format!("{file_name}.{}.tmp", Uuid::new_v4()));

    let write_result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|source| StorageError::Io {
                operation: "creating a temporary data file",
                source,
            })?;
        file.write_all(bytes).map_err(|source| StorageError::Io {
            operation: "writing a temporary data file",
            source,
        })?;
        file.sync_all().map_err(|source| StorageError::Io {
            operation: "flushing a temporary data file",
            source,
        })?;
        drop(file);
        replace_file(&temporary, destination)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), StorageError> {
    if !destination.exists() {
        return fs::rename(temporary, destination).map_err(|source| StorageError::Io {
            operation: "installing the first data file",
            source,
        });
    }

    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};
    use winapi::um::winbase::REPLACEFILE_WRITE_THROUGH;

    #[link(name = "kernel32")]
    extern "system" {
        #[link_name = "ReplaceFileW"]
        fn replace_file_w(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut c_void,
            reserved: *mut c_void,
        ) -> i32;
    }

    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        replace_file_w(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err(StorageError::Io {
            operation: "replacing the data file",
            source: io::Error::last_os_error(),
        });
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), StorageError> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|source| StorageError::Io {
            operation: "removing the previous data file",
            source,
        })?;
    }
    fs::rename(temporary, destination).map_err(|source| StorageError::Io {
        operation: "replacing the data file",
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::{JsonStore, StorageError, StoredDocument};
    use serde::{Deserialize, Serialize};
    use std::{fs, sync::Arc, thread};
    use tempfile::tempdir;

    #[derive(Clone, Debug, Default, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TestDocument {
        schema_version: u32,
        revision: u64,
        values: Vec<u64>,
    }

    impl StoredDocument for TestDocument {
        const SCHEMA_VERSION: u32 = 1;

        fn schema_version(&self) -> u32 {
            self.schema_version
        }

        fn validate(&self) -> Result<(), StorageError> {
            if self.schema_version != Self::SCHEMA_VERSION && self.schema_version != 0 {
                return Err(StorageError::UnsupportedSchema {
                    found: self.schema_version,
                    expected: Self::SCHEMA_VERSION,
                });
            }
            Ok(())
        }
    }

    fn initialized(document: &mut TestDocument) {
        if document.schema_version == 0 {
            document.schema_version = 1;
        }
    }

    #[test]
    fn first_write_and_backup_replacement() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.json");
        let store = JsonStore::<TestDocument>::new(path.clone());
        store
            .mutate(|document| {
                initialized(document);
                document.values.push(1);
                document.revision += 1;
                Ok(())
            })
            .unwrap();
        assert!(!path.with_extension("json.bak").exists());

        store
            .mutate(|document| {
                document.values.push(2);
                document.revision += 1;
                Ok(())
            })
            .unwrap();
        let backup = fs::read_to_string(path.with_extension("json.bak")).unwrap();
        assert!(backup.contains("\"revision\": 1"));
        assert_eq!(store.read().unwrap().values, vec![1, 2]);
    }

    #[test]
    fn privacy_mutation_removes_the_recovery_backup() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.json");
        let backup = path.with_extension("json.bak");
        let store = JsonStore::<TestDocument>::new(path);
        for value in [1, 2] {
            store
                .mutate(|document| {
                    initialized(document);
                    document.values.push(value);
                    document.revision += 1;
                    Ok(())
                })
                .unwrap();
        }
        assert!(backup.exists());

        store
            .mutate_and_purge_backup(|document| {
                document.values.clear();
                document.revision += 1;
                Ok(())
            })
            .unwrap();

        assert!(store.read().unwrap().values.is_empty());
        assert!(!backup.exists());
    }

    #[test]
    fn malformed_primary_is_preserved() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.json");
        fs::write(&path, b"{not-json").unwrap();
        let store = JsonStore::<TestDocument>::new(path.clone());
        assert!(matches!(store.read(), Err(StorageError::Malformed)));
        assert!(matches!(
            store.mutate(|_| Ok(())),
            Err(StorageError::Malformed)
        ));
        assert_eq!(fs::read(path).unwrap(), b"{not-json");
    }

    #[test]
    fn unsupported_schema_is_not_overwritten() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.json");
        fs::write(&path, br#"{"schemaVersion":2,"revision":0,"values":[]}"#).unwrap();
        let store = JsonStore::<TestDocument>::new(path.clone());
        assert!(matches!(
            store.mutate(|_| Ok(())),
            Err(StorageError::UnsupportedSchema { found: 2, .. })
        ));
    }

    #[test]
    fn operations_are_serialized() {
        let directory = tempdir().unwrap();
        let store = Arc::new(JsonStore::<TestDocument>::new(
            directory.path().join("data.json"),
        ));
        let threads = (0..8)
            .map(|value| {
                let store = store.clone();
                thread::spawn(move || {
                    store
                        .mutate(|document| {
                            initialized(document);
                            document.values.push(value);
                            document.revision += 1;
                            Ok(())
                        })
                        .unwrap();
                })
            })
            .collect::<Vec<_>>();
        for thread in threads {
            thread.join().unwrap();
        }
        let document = store.read().unwrap();
        assert_eq!(document.revision, 8);
        assert_eq!(document.values.len(), 8);
    }

    #[test]
    fn abandoned_temp_file_is_ignored() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.json");
        fs::write(directory.path().join("data.json.abandoned.tmp"), b"bad").unwrap();
        let store = JsonStore::<TestDocument>::new(path);
        assert!(store.read().unwrap().values.is_empty());
    }
}
