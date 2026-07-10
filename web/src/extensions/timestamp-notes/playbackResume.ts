export type ResumeDecision = {
  pausedByExtension: boolean;
  sawExpectedPause: boolean;
  manualPauseChange: boolean;
  capturedMediaKey: string;
  currentMediaKey: string | null;
  currentlyPaused: boolean | null;
};

export function shouldResumePlayback(decision: ResumeDecision): boolean {
  return (
    decision.pausedByExtension &&
    decision.sawExpectedPause &&
    !decision.manualPauseChange &&
    decision.currentMediaKey === decision.capturedMediaKey &&
    decision.currentlyPaused === true
  );
}
