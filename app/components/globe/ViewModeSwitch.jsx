import "./hud.css";

const OPTIONS = [
  ["3d", "3D"],
  ["2d", "2D"],
];

// Segmented 3D / 2D control for the country view. Hidden in orbit, disabled mid-flight.
function ViewModeSwitch({ visible, enabled, mode, onChange }) {
  return (
    <div className="view-switch" data-visible={visible} data-mode={mode} role="group" aria-label="Map view">
      {OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="view-switch-option"
          aria-pressed={mode === value}
          disabled={!enabled}
          tabIndex={visible ? 0 : -1}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default ViewModeSwitch;
