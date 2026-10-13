import { Search, X } from "lucide-react";
import { Input, IconButton } from "../../ui";

interface SettingsSearchProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  clearLabel?: string;
}

export function SettingsSearch({
  label,
  placeholder,
  value,
  onChange,
  clearLabel = "清除搜索",
}: SettingsSearchProps) {
  return (
    <label className="settings-search">
      <Search size={17} aria-hidden="true" />
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <IconButton label={clearLabel} size="sm" onClick={() => onChange("")}>
          <X size={14} />
        </IconButton>
      )}
    </label>
  );
}
