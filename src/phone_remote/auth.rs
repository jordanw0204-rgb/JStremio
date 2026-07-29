use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use std::{
    collections::HashMap,
    net::IpAddr,
    time::{Duration, Instant},
};

pub(crate) const PAIRING_TTL: Duration = Duration::from_secs(2 * 60);
const SESSION_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
const SESSION_ABSOLUTE_TTL: Duration = Duration::from_secs(8 * 60 * 60);
const PAIR_ATTEMPTS_PER_MINUTE: u32 = 10;
const COMMANDS_PER_SECOND: u32 = 15;

struct PairingSecret {
    value: String,
    expires_at: Instant,
}

struct Session {
    created_at: Instant,
    last_seen: Instant,
    command_window: Instant,
    commands: u32,
}

struct AttemptWindow {
    started_at: Instant,
    attempts: u32,
}

#[derive(Default)]
pub(crate) struct AuthStore {
    pairing: Option<PairingSecret>,
    sessions: HashMap<String, Session>,
    pair_attempts: HashMap<IpAddr, AttemptWindow>,
}

impl AuthStore {
    pub fn new_pairing(&mut self) -> (String, DateTime<Utc>) {
        let expires_at_utc = Utc::now()
            + ChronoDuration::from_std(PAIRING_TTL).expect("pairing duration is representable");
        let value = random_token();
        self.pairing = Some(PairingSecret {
            value: value.clone(),
            expires_at: Instant::now() + PAIRING_TTL,
        });
        (value, expires_at_utc)
    }

    pub fn exchange_pairing(&mut self, candidate: &str, peer: IpAddr) -> Option<String> {
        if !self.allow_pair_attempt(peer) {
            return None;
        }
        let now = Instant::now();
        let accepted = self.pairing.as_ref().is_some_and(|pairing| {
            pairing.expires_at > now && constant_time_equal(&pairing.value, candidate)
        });
        if !accepted {
            return None;
        }
        self.pairing = None;
        let token = random_token();
        self.sessions.insert(
            token.clone(),
            Session {
                created_at: now,
                last_seen: now,
                command_window: now,
                commands: 0,
            },
        );
        Some(token)
    }

    pub fn validate_session(&mut self, token: &str, count_command: bool) -> bool {
        self.remove_expired();
        let now = Instant::now();
        let Some(session) = self.sessions.get_mut(token) else {
            return false;
        };
        if count_command {
            if now.duration_since(session.command_window) >= Duration::from_secs(1) {
                session.command_window = now;
                session.commands = 0;
            }
            if session.commands >= COMMANDS_PER_SECOND {
                return false;
            }
            session.commands += 1;
        }
        session.last_seen = now;
        true
    }

    pub fn revoke_all(&mut self) {
        self.pairing = None;
        self.sessions.clear();
        self.pair_attempts.clear();
    }

    pub fn session_count(&mut self) -> usize {
        self.remove_expired();
        self.sessions.len()
    }

    fn allow_pair_attempt(&mut self, peer: IpAddr) -> bool {
        let now = Instant::now();
        self.pair_attempts
            .retain(|_, window| now.duration_since(window.started_at) < Duration::from_secs(60));
        let window = self.pair_attempts.entry(peer).or_insert(AttemptWindow {
            started_at: now,
            attempts: 0,
        });
        if now.duration_since(window.started_at) >= Duration::from_secs(60) {
            window.started_at = now;
            window.attempts = 0;
        }
        if window.attempts >= PAIR_ATTEMPTS_PER_MINUTE {
            return false;
        }
        window.attempts += 1;
        true
    }

    fn remove_expired(&mut self) {
        let now = Instant::now();
        self.sessions.retain(|_, session| {
            now.duration_since(session.last_seen) < SESSION_IDLE_TTL
                && now.duration_since(session.created_at) < SESSION_ABSOLUTE_TTL
        });
        if self
            .pairing
            .as_ref()
            .is_some_and(|pairing| pairing.expires_at <= now)
        {
            self.pairing = None;
        }
    }
}

fn random_token() -> String {
    let first = uuid::Uuid::new_v4();
    let second = uuid::Uuid::new_v4();
    let mut bytes = [0_u8; 32];
    bytes[..16].copy_from_slice(first.as_bytes());
    bytes[16..].copy_from_slice(second.as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn constant_time_equal(expected: &str, candidate: &str) -> bool {
    if expected.len() != candidate.len() {
        return false;
    }
    expected
        .as_bytes()
        .iter()
        .zip(candidate.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::AuthStore;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn pairing_is_one_use_and_sessions_can_be_revoked() {
        let peer = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20));
        let mut auth = AuthStore::default();
        let (pairing, _) = auth.new_pairing();
        let session = auth.exchange_pairing(&pairing, peer).unwrap();
        assert!(auth.exchange_pairing(&pairing, peer).is_none());
        assert!(auth.validate_session(&session, false));
        auth.revoke_all();
        assert!(!auth.validate_session(&session, false));
    }

    #[test]
    fn pairing_attempts_are_rate_limited() {
        let peer = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 21));
        let mut auth = AuthStore::default();
        for _ in 0..10 {
            assert!(auth.exchange_pairing("wrong", peer).is_none());
        }
        let (pairing, _) = auth.new_pairing();
        assert!(auth.exchange_pairing(&pairing, peer).is_none());
    }
}
