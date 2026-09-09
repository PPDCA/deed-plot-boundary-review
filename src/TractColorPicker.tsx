import { roleColor, effectiveColor } from "./tractColor";
import type { Tract } from "./types";

interface Props {
  tract: Tract;
  /** Called with a hex string to set the override, or null to clear it. */
  onChange: (color: string | null) => void;
  disabled?: boolean;
  label?: string;
}

/** The colour control used wherever a tract is reviewed before plotting.

    It shows the colour the tract will be drawn in, whether that is its own or
    its role's, and only writes a `color` into the call sheet once the reviewer
    actually picks one -- so a sheet nobody has recoloured stays byte-identical
    to what the transcription produced. */
export default function TractColorPicker({ tract, onChange, disabled, label }: Props) {
  const custom = typeof tract.color === "string" && tract.color.trim() !== "";
  const value = effectiveColor(tract);
  const role = String(tract.role ?? "subject").toLowerCase();

  return (
    <span className="tract-color">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label ?? `Colour for ${tract.name ?? "this tract"}`}
        title={
          custom
            ? `Custom colour ${value}. Drawing only — geometry is unaffected.`
            : `${role} default ${value}. Pick a colour to override it.`
        }
      />
      {custom ? (
        <button
          type="button"
          className="color-reset"
          onClick={() => onChange(null)}
          disabled={disabled}
          title={`Back to the ${role} default (${roleColor(role)})`}
        >
          reset
        </button>
      ) : (
        <span className="color-hint">{role} default</span>
      )}
    </span>
  );
}
