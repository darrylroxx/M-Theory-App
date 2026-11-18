//! Keeping the live sound safe from the rest of the computer.
//!
//! - Very quiet numbers ("denormals"), which reverb and filter tails decay into, can make the
//!   processor up to a hundred times slower on each sample. Inside the audio callbacks they are
//!   rounded to zero, so a fading reverb can never cause a dropout.
//! - On Windows, the driver's audio thread joins the "Pro Audio" class of the multimedia
//!   scheduler (MMCSS), as professional recording software does, so other programs cannot
//!   push it aside.
//! - While the interface is open, Windows is asked not to slow the app down to save power when
//!   it is in the background, and not to let the computer go to sleep in the middle of a take.

/// Rounds denormals to zero while it lives, and puts things back as they were afterwards.
pub struct NoDenormals {
    #[cfg(any(target_arch = "x86_64", target_arch = "x86"))]
    old: u32,
}

impl NoDenormals {
    #[inline]
    #[allow(deprecated)]
    pub fn new() -> Self {
        #[cfg(target_arch = "x86_64")]
        {
            use std::arch::x86_64::{_mm_getcsr, _mm_setcsr};
            // SAFETY: only the flush-to-zero (bit 15) and denormals-are-zero (bit 6) flags change
            unsafe {
                let old = _mm_getcsr();
                _mm_setcsr(old | 0x8040);
                NoDenormals { old }
            }
        }
        #[cfg(target_arch = "x86")]
        {
            use std::arch::x86::{_mm_getcsr, _mm_setcsr};
            // SAFETY: as above
            unsafe {
                let old = _mm_getcsr();
                _mm_setcsr(old | 0x8040);
                NoDenormals { old }
            }
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "x86")))]
        NoDenormals {}
    }
}

impl Drop for NoDenormals {
    #[inline]
    #[allow(deprecated)]
    fn drop(&mut self) {
        #[cfg(target_arch = "x86_64")]
        // SAFETY: restores the value read in `new`
        unsafe {
            std::arch::x86_64::_mm_setcsr(self.old)
        }
        #[cfg(target_arch = "x86")]
        // SAFETY: as above
        unsafe {
            std::arch::x86::_mm_setcsr(self.old)
        }
    }
}

/// Called at the top of every audio callback: the first time on a thread, it asks Windows to
/// treat that thread as professional audio. Costs nothing after that.
#[inline]
pub fn audio_thread() {
    #[cfg(windows)]
    {
        use std::cell::Cell;
        thread_local! { static DONE: Cell<bool> = const { Cell::new(false) }; }
        DONE.with(|d| {
            if !d.get() {
                d.set(true);
                win::pro_audio();
            }
        });
    }
}

/// While this lives, Windows keeps the app at full speed and the computer awake. It is kept
/// by the thread that looks after the open interface.
pub struct Session {
    _p: (),
}

impl Session {
    pub fn begin() -> Self {
        #[cfg(windows)]
        win::begin();
        Session { _p: () }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        #[cfg(windows)]
        win::end();
    }
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
    use windows_sys::Win32::System::Threading::{
        AvSetMmThreadCharacteristicsW, GetCurrentProcess, SetPriorityClass, SetProcessInformation, ProcessPowerThrottling, ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };

    pub fn pro_audio() {
        let name: Vec<u16> = "Pro Audio\0".encode_utf16().collect();
        let mut index = 0u32;
        // SAFETY: a valid, nul-terminated name and a place for the task index. The handle is
        // kept for the life of the thread (the driver's), which is what the scheduler expects.
        unsafe {
            AvSetMmThreadCharacteristicsW(name.as_ptr(), &mut index);
        }
    }

    pub fn begin() {
        // SAFETY: plain Win32 calls on this process and thread, with a correctly sized struct
        unsafe {
            let me = GetCurrentProcess();
            // never slowed down to save power ("efficiency mode"), even when in the background
            let state = PROCESS_POWER_THROTTLING_STATE { Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION, ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED, StateMask: 0 };
            SetProcessInformation(me, ProcessPowerThrottling, &state as *const _ as *const core::ffi::c_void, std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32);
            SetPriorityClass(me, ABOVE_NORMAL_PRIORITY_CLASS);
            // no sleep in the middle of a take
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        }
    }

    pub fn end() {
        // SAFETY: as above
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(any(target_arch = "x86_64", target_arch = "x86"))]
    fn denormals_are_rounded_to_zero_inside_and_restored_after() {
        let tiny = std::hint::black_box(1.0e-38f32);
        {
            let _g = NoDenormals::new();
            let x = std::hint::black_box(tiny) * std::hint::black_box(0.001f32);
            assert_eq!(x, 0.0, "a denormal result becomes zero");
        }
        let x = std::hint::black_box(tiny) * std::hint::black_box(0.001f32);
        assert!(x > 0.0, "outside, the processor works as before");
    }
}
