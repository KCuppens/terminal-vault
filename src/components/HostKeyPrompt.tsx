import type { HostKeyPromptInfo } from "../ipc";

interface Props {
  prompt: HostKeyPromptInfo;
  onAnswer(accept: boolean): void;
}

export function HostKeyPrompt({ prompt, onAnswer }: Props) {
  const changed = prompt.expected_fingerprint !== null;
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className={changed ? "card dialog danger-card" : "card dialog"}>
        <h2>{changed ? "Host key has changed" : "Unknown host"}</h2>
        {changed ? (
          <p className="error">
            The key presented by {prompt.addr_port} does not match the one on record. This can mean
            someone is intercepting the connection. Only continue if you know the server was
            reinstalled.
          </p>
        ) : (
          <p>
            The authenticity of <strong>{prompt.host_name}</strong> ({prompt.addr_port}) cannot be
            established. Verify the fingerprint with the server owner before trusting it.
          </p>
        )}
        <dl>
          <dt>Key type</dt>
          <dd>{prompt.key_type}</dd>
          <dt>{changed ? "Presented" : "SHA256 fingerprint"}</dt>
          <dd className="mono">{prompt.fingerprint}</dd>
          {changed && (
            <>
              <dt>On record</dt>
              <dd className="mono">{prompt.expected_fingerprint}</dd>
            </>
          )}
        </dl>
        <div className="row end">
          <button autoFocus onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button className={changed ? "danger" : "primary"} onClick={() => onAnswer(true)}>
            {changed ? "Replace key and connect" : "Trust and connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
