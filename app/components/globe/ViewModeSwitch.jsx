import "./hud.css";

const OPTIONS = [
  ["2d", "2D"],
  ["3d", "3D"],
];

// Segmented 3D / 2D control for the country view.
function ViewModeSwitch({ enabled, mode, onChange }) {
  return (
    <div className="view-switch" data-mode={mode} role="group" aria-label="Map view">
      {OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="view-switch-option"
          aria-pressed={mode === value}
          disabled={!enabled}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default ViewModeSwitch;
