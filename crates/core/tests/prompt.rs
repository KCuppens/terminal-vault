use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tvcore::prompt::PromptGate;
use uuid::Uuid;

/// Spawns `ask` with a shared "pinned" flag and a counter of how many prompts were shown.
fn ask(
    gate: &Arc<PromptGate>,
    pinned: &Arc<AtomicBool>,
    shown: &Arc<AtomicUsize>,
    ids: tokio::sync::mpsc::UnboundedSender<Uuid>,
) -> tokio::task::JoinHandle<Result<(), String>> {
    let (gate, pinned, shown) = (gate.clone(), pinned.clone(), shown.clone());
    tokio::spawn(async move {
        let (p1, p2) = (pinned.clone(), pinned);
        gate.ask(
            move || Ok(p1.load(Ordering::SeqCst)),
            move |id| {
                shown.fetch_add(1, Ordering::SeqCst);
                ids.send(id).unwrap();
                Ok(())
            },
            |_| {},
            move || {
                p2.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .await
    })
}

#[tokio::test]
async fn parallel_asks_for_one_host_prompt_once() {
    let gate = Arc::new(PromptGate::new(Duration::from_secs(5)));
    let pinned = Arc::new(AtomicBool::new(false));
    let shown = Arc::new(AtomicUsize::new(0));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    let a = ask(&gate, &pinned, &shown, tx.clone());
    let b = ask(&gate, &pinned, &shown, tx);
    let id = rx.recv().await.unwrap();
    gate.answer(id, true).unwrap();

    a.await.unwrap().unwrap();
    b.await.unwrap().unwrap();
    assert_eq!(shown.load(Ordering::SeqCst), 1);
    assert!(pinned.load(Ordering::SeqCst));
}

#[tokio::test]
async fn declined_prompt_pins_nothing() {
    let gate = Arc::new(PromptGate::new(Duration::from_secs(5)));
    let pinned = Arc::new(AtomicBool::new(false));
    let shown = Arc::new(AtomicUsize::new(0));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    let a = ask(&gate, &pinned, &shown, tx);
    let id = rx.recv().await.unwrap();
    gate.answer(id, false).unwrap();

    assert!(a.await.unwrap().is_err());
    assert!(!pinned.load(Ordering::SeqCst));
}

#[tokio::test]
async fn unanswered_prompt_times_out_and_frees_the_gate() {
    let gate = Arc::new(PromptGate::new(Duration::from_millis(50)));
    let pinned = Arc::new(AtomicBool::new(false));
    let shown = Arc::new(AtomicUsize::new(0));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    let a = ask(&gate, &pinned, &shown, tx.clone());
    let id = rx.recv().await.unwrap();
    assert!(a.await.unwrap().is_err());
    assert!(!pinned.load(Ordering::SeqCst));
    assert!(
        gate.answer(id, true).is_err(),
        "timed-out prompt must be gone"
    );

    let b = ask(&gate, &pinned, &shown, tx);
    let id = rx.recv().await.unwrap();
    gate.answer(id, true).unwrap();
    b.await.unwrap().unwrap();
}

#[tokio::test]
async fn close_callback_gets_the_shown_id_when_a_prompt_times_out() {
    let gate = Arc::new(PromptGate::new(Duration::from_millis(50)));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let shown = tx.clone();
    let res = gate
        .ask(
            || Ok(false),
            move |id| {
                shown.send(("show", id)).unwrap();
                Ok(())
            },
            move |id| tx.send(("close", id)).unwrap(),
            || Ok(()),
        )
        .await;
    assert!(res.is_err());
    let (a, shown_id) = rx.recv().await.unwrap();
    let (b, closed_id) = rx.recv().await.unwrap();
    assert_eq!((a, b), ("show", "close"));
    assert_eq!(shown_id, closed_id);
}

#[tokio::test]
async fn clear_declines_open_prompts() {
    let gate = Arc::new(PromptGate::new(Duration::from_secs(5)));
    let pinned = Arc::new(AtomicBool::new(false));
    let shown = Arc::new(AtomicUsize::new(0));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    let a = ask(&gate, &pinned, &shown, tx);
    let id = rx.recv().await.unwrap();
    gate.clear();

    assert!(a.await.unwrap().is_err());
    assert!(!pinned.load(Ordering::SeqCst));
    assert!(gate.answer(id, true).is_err());
}

#[tokio::test]
async fn failed_show_leaves_no_pending_prompt_and_frees_the_gate() {
    let gate = PromptGate::new(Duration::from_secs(5));
    let seen = std::sync::Mutex::new(None);
    let res = gate
        .ask(
            || Ok(false),
            |id| {
                *seen.lock().unwrap() = Some(id);
                Err("no window".to_string())
            },
            |_| panic!("close must not run when show failed"),
            || Ok(()),
        )
        .await;
    assert_eq!(res, Err("no window".to_string()));
    assert!(gate.answer(seen.lock().unwrap().unwrap(), true).is_err());
    assert!(gate
        .ask(|| Ok(true), |_| Ok(()), |_| {}, || Ok(()))
        .await
        .is_ok());
}
