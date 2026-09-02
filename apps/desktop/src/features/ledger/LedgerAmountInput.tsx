import { translate } from "../../i18n/i18n";
import { Input } from "@mono/ui";

interface LedgerAmountInputProps {
  autoFocus?: boolean;
  label?: string;
  onChange: (value: string) => void;
  value: string;
}

export function formatLedgerAmountInput(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}

export function LedgerAmountInput({ autoFocus = false, label = translate("ledger.field.amount"), onChange, value }: LedgerAmountInputProps) {
  return (
    <div className="ledger-amount-input">
      <b aria-hidden="true">₩</b>
      <Input
        aria-label={label}
        autoFocus={autoFocus}
        inputMode="numeric"
        onChange={(event) => onChange(formatLedgerAmountInput(event.target.value))}
        placeholder="16,000"
        value={formatLedgerAmountInput(value)}
      />
    </div>
  );
}
