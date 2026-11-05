import { Button, ColorPicker, Icon, IconButton, Input, Modal, Select, type IconName, type SelectOption } from "@mono/ui";
import type { FormEvent, ReactNode } from "react";
import { translate } from "../i18n/i18n";

export type LabelManagerItem = {
  id: string;
  name: string;
  /** Absent for colorless labels (scrap tags): no swatch is drawn. */
  color?: string;
  usageLabel: string;
  /** When set, the delete button is disabled and this text becomes its tooltip. */
  deleteDisabledReason?: string;
};

/** The ids after moving one row up or down, or null when the move would leave the list. */
export function reorderedIds(ids: string[], index: number, offset: -1 | 1): string[] | null {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= ids.length) return null;
  const next = [...ids];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

/**
 * The shared label/category manager: a list of rows above an add/edit form. Presentational only — each feature
 * keeps its own state, mutations and conflict handling, and passes the result in.
 */
export function LabelManagerModal({
  open, icon, listLabel, items, busy, error, onClose, onMove, onEdit, onDelete,
  editing, name, onNameChange, color, onColorChange, onCancelEdit, onSubmit, formId, autoFocusName = true, emptyMessage,
}: {
  open: boolean;
  icon: IconName;
  listLabel: string;
  items: LabelManagerItem[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  /** Absent: rows have no reorder buttons. */
  onMove?: (index: number, offset: -1 | 1) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  editing: boolean;
  name: string;
  onNameChange: (name: string) => void;
  /** Absent: the form has no color picker. */
  color?: string;
  onColorChange?: (color: string) => void;
  onCancelEdit: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  formId?: string;
  autoFocusName?: boolean;
  emptyMessage?: string;
}) {
  const withColor = color !== undefined && onColorChange !== undefined;
  return (
    <Modal className={withColor ? "ui-modal--medium ui-modal--overflow ui-modal--flush" : "ui-modal--medium ui-modal--flush"} icon={icon} onClose={onClose} open={open} title={translate("common.labels.manage")}>
      <div className="ui-manager">
        <div aria-label={listLabel} className="ui-manager__list">
          {items.map((item, index) => (
            <div className="ui-manager__row" key={item.id}>
              {item.color !== undefined && <i style={{ backgroundColor: item.color }} />}
              <strong>{item.name}</strong>
              <span>{item.usageLabel}</span>
              <div>
                {onMove && <IconButton aria-label={translate("common.action.moveUpLabel", { name: item.name })} disabled={busy || index === 0} onClick={() => onMove(index, -1)} size="small" title={translate("common.action.moveUp")} type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>}
                {onMove && <IconButton aria-label={translate("common.action.moveDownLabel", { name: item.name })} disabled={busy || index === items.length - 1} onClick={() => onMove(index, 1)} size="small" title={translate("common.action.moveDown")} type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>}
                <IconButton aria-label={translate("common.action.editLabel", { name: item.name })} disabled={busy} onClick={() => onEdit(item.id)} size="small" title={translate("common.action.edit")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                <IconButton aria-label={item.deleteDisabledReason ? translate("common.action.deleteDisabledLabel", { name: item.name }) : translate("common.action.deleteLabel", { name: item.name })} disabled={busy || item.deleteDisabledReason !== undefined} onClick={() => onDelete(item.id)} size="small" title={item.deleteDisabledReason ?? translate("common.action.delete")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
              </div>
            </div>
          ))}
          {items.length === 0 && emptyMessage && <div className="ui-manager__empty">{emptyMessage}</div>}
        </div>
        <form aria-busy={busy} className="ui-manager__editor" id={formId} onSubmit={onSubmit}>
          <div className="ui-manager__editor-header">
            <strong>{editing ? translate("common.labels.edit") : translate("common.labels.new")}</strong>
            {editing && <button disabled={busy} onClick={onCancelEdit} type="button">{translate("common.action.cancel")}</button>}
          </div>
          <div className="ui-manager__controls">
            {color !== undefined && onColorChange && <ColorPicker disabled={busy} label={translate("common.labels.color")} onChange={onColorChange} selected value={color} />}
            <Input aria-label={translate("common.labels.name")} autoFocus={autoFocusName} disabled={busy} maxLength={100} onChange={(event) => onNameChange(event.target.value)} placeholder={translate("common.labels.name")} value={name} />
            <Button loading={busy} type="submit" variant="primary">{editing ? translate("common.action.save") : translate("common.action.add")}</Button>
          </div>
          {error && <div className="ui-form-error" role="alert"><Icon name="alert" size={13} />{error}</div>}
        </form>
      </div>
    </Modal>
  );
}

/**
 * The shared "delete this label" confirm. With `move`, existing items are reassigned to a chosen label;
 * without it (ledger), the message itself explains where they go.
 */
export function LabelDeleteModal({ open, busy, message, move, error, onCancel, onConfirm }: {
  open: boolean;
  busy: boolean;
  message: ReactNode;
  move?: { label: string; description: string; options: SelectOption[]; value: string; onChange: (value: string) => void };
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      className={move ? "ui-modal--small ui-modal--overflow ui-modal--confirm ui-modal--danger" : "ui-modal--small ui-modal--confirm ui-modal--danger"}
      footer={<><Button disabled={busy} onClick={onCancel}>{translate("common.action.cancel")}</Button><Button loading={busy} onClick={onConfirm} variant="danger">{translate("common.action.delete")}</Button></>}
      icon="alert"
      onClose={() => { if (!busy) onCancel(); }}
      open={open}
      title={translate("common.labels.deleteTitle")}
    >
      <div className="ui-form">
        <p>{message}</p>
        {move && (
          <label>
            <span>{move.label}</span>
            <Select disabled={busy} label={translate("common.labels.moveTarget")} onChange={move.onChange} options={move.options} value={move.value} />
          </label>
        )}
        {move && <small>{move.description}</small>}
        {error && <div className="ui-form-error" role="alert"><Icon name="alert" size={13} />{error}</div>}
      </div>
    </Modal>
  );
}
