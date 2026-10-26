use std::time::Duration;

const FREE_ATTEMPTS: u32 = 3;
const BASE_DELAY_SECS: u64 = 5;
const MAX_DELAY_SECS: u64 = 60;

/// Slows down passphrase guessing. The first three wrong passphrases are free; after that every
/// further failure doubles the wait (5s, 10s, 20s, ...) up to 60s. The clock is passed in as a
/// monotonic offset, so tests need no sleeping.
#[derive(Debug, Default)]
pub struct UnlockThrottle {
    failures: u32,
    blocked_until: Duration,
}

impl UnlockThrottle {
    /// `Err(seconds)` while attempts are refused; the number is rounded up and at least 1.
    pub fn check(&self, now: Duration) -> Result<(), u64> {
        match self.blocked_until.checked_sub(now) {
            Some(left) if !left.is_zero() => {
                Err(left.as_secs() + u64::from(left.subsec_nanos() > 0))
            }
            _ => Ok(()),
        }
    }

    pub fn record_failure(&mut self, now: Duration) {
        self.failures = self.failures.saturating_add(1);
        if self.failures >= FREE_ATTEMPTS {
            let exp = (self.failures - FREE_ATTEMPTS).min(8);
            let secs = (BASE_DELAY_SECS << exp).min(MAX_DELAY_SECS);
            self.blocked_until = now + Duration::from_secs(secs);
        }
    }

    pub fn record_success(&mut self) {
        *self = Self::default();
    }

    pub fn message(secs: u64) -> String {
        format!("too many attempts: retry in {secs}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn three_free_attempts_then_growing_delays() {
        let mut t = UnlockThrottle::default();
        let mut now = secs(100);
        for _ in 0..2 {
            assert_eq!(t.check(now), Ok(()));
            t.record_failure(now);
        }
        assert_eq!(t.check(now), Ok(()));
        t.record_failure(now);
        assert_eq!(t.check(now), Err(5));
        assert_eq!(t.check(now + Duration::from_millis(4_500)), Err(1));
        now += secs(5);
        assert_eq!(t.check(now), Ok(()));

        let mut expected = [10, 20, 40, 60, 60, 60].into_iter();
        for want in expected.by_ref() {
            t.record_failure(now);
            assert_eq!(t.check(now), Err(want));
            now += secs(want);
            assert_eq!(t.check(now), Ok(()));
        }
    }

    #[test]
    fn success_resets() {
        let mut t = UnlockThrottle::default();
        let now = secs(1);
        for _ in 0..4 {
            t.record_failure(now);
        }
        assert!(t.check(now).is_err());
        t.record_success();
        assert_eq!(t.check(now), Ok(()));
        t.record_failure(now);
        t.record_failure(now);
        assert_eq!(t.check(now), Ok(()));
    }

    #[test]
    fn many_failures_do_not_overflow() {
        let mut t = UnlockThrottle::default();
        for _ in 0..1000 {
            t.record_failure(secs(0));
        }
        assert_eq!(t.check(secs(0)), Err(60));
    }

    #[test]
    fn message_text() {
        assert_eq!(UnlockThrottle::message(7), "too many attempts: retry in 7s");
    }
}
