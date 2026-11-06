import { brandAscii } from "./brand-ascii";

export default function AsciiBrand() {
  return (
    <div className="ascii-brand" aria-hidden="true">
      <pre>{brandAscii}</pre>
    </div>
  );
}
