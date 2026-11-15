/**
 * On-screen controls for touch screens, laid out for a phone held sideways: steering on the
 * left, handbrake, brake and gas on the right, reset and pause at the top right. Each
 * button holds its control while a finger is on it (several at once), writing to the drive
 * session the car reads every physics step.
 */
import { useEffect, type ReactNode } from 'react';
import type { DriveKeys } from '../car/controls';
import type { DriveSession } from '../scene/driveSession';
import { Chevron, Handbrake, Pause, Reset } from './icons';

export function TouchControls({ session, onPause }: { session: DriveSession; onPause: () => void }) {
  // Let go of everything when the controls go away (pause, big map, leaving).
  useEffect(() => {
    const release = () => session.releaseTouch();
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('blur', release);
      release();
    };
  }, [session]);

  return (
    <div className="touch-controls" onContextMenu={(e) => e.preventDefault()}>
      <div className="top">
        <button type="button" className="pad small" aria-label="Reset the car" onClick={() => session.requestReset()}>
          <Reset />
        </button>
        <button type="button" className="pad small" aria-label="Pause" onClick={onPause}>
          <Pause />
        </button>
      </div>
      <div className="steer">
        <Hold session={session} control="left" label="Steer left" className="round">
          <Chevron dir="left" />
        </Hold>
        <Hold session={session} control="right" label="Steer right" className="round">
          <Chevron dir="right" />
        </Hold>
      </div>
      <div className="pedals">
        <Hold session={session} control="handbrake" label="Handbrake" className="round hand">
          <Handbrake size={26} />
        </Hold>
        <Hold session={session} control="down" label="Brake" className="brake">
          <Lines n={3} />
          BRAKE
        </Hold>
        <Hold session={session} control="up" label="Gas" className="gas">
          <Lines n={5} />
          GAS
        </Hold>
      </div>
    </div>
  );
}

/** A button that holds one control while pressed. */
function Hold({ session, control, label, className, children }: { session: DriveSession; control: keyof DriveKeys; label: string; className: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`pad ${className}`}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.classList.add('down');
        session.setTouch(control, true);
      }}
      onPointerUp={(e) => {
        e.currentTarget.classList.remove('down');
        session.setTouch(control, false);
      }}
      onPointerCancel={(e) => {
        e.currentTarget.classList.remove('down');
        session.setTouch(control, false);
      }}
    >
      {children}
    </button>
  );
}

/** The grip lines on a pedal. */
function Lines({ n }: { n: number }) {
  return (
    <span className="lines" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
