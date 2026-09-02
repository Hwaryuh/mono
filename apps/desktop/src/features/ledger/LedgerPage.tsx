import { translate } from "../../i18n/i18n";
import { ledgerCategoryWriteInputSchema, ledgerWriteInputSchema, type LedgerCategory, type LedgerCategoryWriteInput, type LedgerExpense, type LedgerSnapshot, type LedgerWriteInput } from "@mono/contracts";
import { Button, ColorPicker, DatePicker, Icon, IconButton, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import type { LedgerRepository } from "./ledger-repository";
import { LedgerAmountInput } from "./LedgerAmountInput";
import { summarizeLedgerMonth } from "./ledger-summary";
import { ledgerViewStateStoreOf, type LedgerViewStateStore } from "./ledger-view-state-store";

export const ledgerQueryKey = ["ledger"] as const;
const dashboardQueryKey = ["dashboard"] as const;

type Draft = {
  title: string;
  amountWon: string;
  date: string;
  categoryId: string;
  note: string;
};

type CategoryCommand =
  | { type: "create"; input: LedgerCategoryWriteInput }
  | { type: "update"; categoryId: string; input: LedgerCategoryWriteInput; expectedVersion: number }
  | { type: "reorder"; categoryIds: string[] }
  | { type: "delete"; categoryId: string };

const blankCategoryDraft: LedgerCategoryWriteInput = { name: "", color: "oklch(0.539 0.082 160.129)" };

function blankDraft(today: string, categories: LedgerCategory[]): Draft {
  return { title: "", amountWon: "", date: today, categoryId: categories[0]?.id ?? "", note: "" };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : translate("ledger.text.001");
}

export function LedgerPage({ repository, viewStateStore }: { repository: LedgerRepository; viewStateStore?: LedgerViewStateStore }) {
  const [store] = useState(() => viewStateStore ?? ledgerViewStateStoreOf());
  const [viewState, setViewState] = useState(() => store.read());
  const { viewMonth } = viewState;
  const [draft, setDraft] = useState<Draft>({ title: "", amountWon: "", date: "", categoryId: "", note: "" });
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryVersion, setEditingCategoryVersion] = useState(1);
  const [categoryDraft, setCategoryDraft] = useState<LedgerCategoryWriteInput>(blankCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const handledNewParamRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: ledgerQueryKey, queryFn: () => repository.getSnapshot() });
  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: (input: LedgerWriteInput) => repository.create(input),
    onMutate: () => setFormError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      closeModal(true);
    },
    onError: (error) => {
      setFormError(errorMessage(error));
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#ledger-expense-form input")?.focus());
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ expenseId, input }: { expenseId: string; input: LedgerWriteInput }) => repository.update(expenseId, input),
    onMutate: () => setFormError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      closeModal(true);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const deleteExpenseMutation = useMutation({
    mutationFn: (expenseId: string) => repository.remove(expenseId),
    onMutate: () => setFormError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      closeModal(true);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const categoryMutation = useMutation({
    mutationFn: async (command: CategoryCommand) => {
      if (command.type === "create") await repository.createCategory(command.input);
      else if (command.type === "update") await repository.updateCategory(command.categoryId, command.input, command.expectedVersion);
      else if (command.type === "reorder") await repository.reorderCategories(command.categoryIds);
      else await repository.deleteCategory(command.categoryId);
    },
    onMutate: () => setCategoryError(null),
    onSuccess: async (_, command) => {
      if (command.type === "create") setCategoryDraft(blankCategoryDraft);
      if (command.type === "update") {
        setEditingCategoryId(null);
        setCategoryDraft(blankCategoryDraft);
      }
      if (command.type === "delete") {
        setDeleteCategoryId(null);
        setEditingCategoryId((current) => current === command.categoryId ? null : current);
        setDraft((current) => current.categoryId === command.categoryId ? { ...current, categoryId: "other" } : current);
      }
      await invalidateSnapshots();
    },
    onError: async (error) => {
      setCategoryError(errorMessage(error));
      if (isConflictError(error) && editingCategoryId) {
        const version = await resyncConflictVersion<LedgerSnapshot>(
          queryClient, ledgerQueryKey, invalidateSnapshots,
          (snapshot) => snapshot.categories.find((candidate) => candidate.id === editingCategoryId),
        );
        if (version !== null) setEditingCategoryVersion(version);
      }
    },
  });

  useEffect(() => {
    const snapshot = snapshotQuery.data;
    if (searchParams.get("modal") !== "new") {
      handledNewParamRef.current = false;
      return;
    }
    if (!snapshot || open || handledNewParamRef.current) return;
    handledNewParamRef.current = true;
    setEditingExpenseId(null);
    setDeleteExpenseId(null);
    setDraft(blankDraft(snapshot.today, snapshot.categories));
    setFormError(null);
    setOpen(true);
  }, [open, searchParams, snapshotQuery.data]);

  if (snapshotQuery.isPending) return <LedgerLoading />;
  if (snapshotQuery.isError) return <div className="ledger-state" role="alert"><Icon name="alert" size={18} />{translate("ledger.text.002")}</div>;

  const snapshot = snapshotQuery.data;
  const editorBusy = createMutation.isPending || updateMutation.isPending || deleteExpenseMutation.isPending;
  const currentMonth = snapshot.today.slice(0, 7);
  const activeMonth = viewMonth ?? currentMonth;
  const isCurrentMonth = activeMonth === currentMonth;
  const summary = summarizeLedgerMonth(snapshot, activeMonth);
  const listExpenses = summary.expenses;
  const [year, month] = activeMonth.split("-").map(Number);
  const fallbackCategoryName = snapshot.categories.find((category) => category.id === "other")?.name ?? translate("scrap.text.047");
  // comparison은 서버가 이번 달 기준으로 선계산하므로 다른 달을 볼 때는 표시하지 않는다.
  const comparison = snapshot.comparison.direction === "same"
    ? translate("ledger.text.003")
    : translate("ledger.text.004", { value1: snapshot.comparison.percentage, value2: snapshot.comparison.direction === "less" ? translate("ledger.text.029") : translate("ledger.text.030") });

  function stepMonth(offset: number) {
    const [y, m] = activeMonth.split("-").map(Number);
    const shifted = new Date(y, m - 1 + offset, 1);
    const next = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
    selectMonth(next === currentMonth ? null : next);
  }

  function selectMonth(nextMonth: string | null) {
    const next = { viewMonth: nextMonth };
    store.write(next);
    setViewState(next);
  }

  function closeModal(force = false) {
    if (editorBusy && !force) return;
    setOpen(false);
    setEditingExpenseId(null);
    setDeleteExpenseId(null);
    setCategoryManagerOpen(false);
    setDeleteCategoryId(null);
    setFormError(null);
    if (searchParams.has("modal")) setSearchParams({}, { replace: true });
  }

  function openEdit(expense: LedgerExpense) {
    setEditingExpenseId(expense.id);
    setDeleteExpenseId(null);
    setDraft({ title: expense.title, amountWon: String(expense.amountWon), date: expense.date, categoryId: expense.categoryId, note: expense.note });
    setFormError(null);
    setOpen(true);
  }

  function openCategoryManager() {
    setEditingCategoryId(null);
    setCategoryDraft(blankCategoryDraft);
    setCategoryError(null);
    setCategoryManagerOpen(true);
  }

  function closeCategoryManager() {
    if (categoryMutation.isPending) return;
    setCategoryManagerOpen(false);
    setEditingCategoryId(null);
    setDeleteCategoryId(null);
    setCategoryError(null);
  }

  function editCategory(category: LedgerCategory) {
    setEditingCategoryId(category.id);
    setEditingCategoryVersion(category.version ?? 1);
    setCategoryDraft({ name: category.name, color: category.color });
    setCategoryError(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const parsed = ledgerCategoryWriteInputSchema.safeParse(categoryDraft);
    if (!parsed.success) {
      setCategoryError(parsed.error.issues[0]?.message ?? translate("todoLabels.text.001"));
      return;
    }
    if (editingCategoryId) categoryMutation.mutate({ type: "update", categoryId: editingCategoryId, input: parsed.data, expectedVersion: editingCategoryVersion });
    else categoryMutation.mutate({ type: "create", input: parsed.data });
  }

  function moveCategory(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= snapshot.categories.length) return;
    const categoryIds = snapshot.categories.map((category) => category.id);
    [categoryIds[index], categoryIds[targetIndex]] = [categoryIds[targetIndex], categoryIds[index]];
    categoryMutation.mutate({ type: "reorder", categoryIds });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = ledgerWriteInputSchema.safeParse({
      title: draft.title,
      amountWon: draft.amountWon,
      date: draft.date,
      categoryId: draft.categoryId,
      note: draft.note,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? translate("ledger.text.005"));
      return;
    }
    if (editingExpenseId) updateMutation.mutate({ expenseId: editingExpenseId, input: parsed.data });
    else createMutation.mutate(parsed.data);
  }

  return (
    <div className="ledger-page">
      <section className="ledger-overview">
        <article className="ledger-total-card">
          <div className="ledger-month-nav">
            <IconButton aria-label={translate("ledger.text.006")} onClick={() => stepMonth(-1)} size="small" type="button" variant="ghost"><Icon name="arrowLeft" size={15} /></IconButton>
            <span className="ledger-month-nav__label">{year}{translate("ledger.text.007")}{month}{translate("ledger.text.008")}</span>
            <IconButton aria-label={translate("ledger.text.009")} disabled={isCurrentMonth} onClick={() => stepMonth(1)} size="small" type="button" variant="ghost"><Icon name="chevronRight" size={15} /></IconButton>
            {!isCurrentMonth && <button className="ledger-month-nav__today" onClick={() => selectMonth(null)} type="button">{translate("ledger.text.010")}</button>}
          </div>
          <strong className={summary.totalWon >= 1_000_000_000 ? "ledger-total-card__amount--large" : undefined}>{formatWon(summary.totalWon)}</strong>
          {isCurrentMonth && <small>{comparison}</small>}
        </article>
        <article aria-label={translate("ledger.text.011")} className="ledger-category-card">
          {summary.categories.map((category) => (
            <div className="ledger-category-row" key={category.id}>
              <i style={{ backgroundColor: category.color }} />
              <span>{category.name}</span>
              <div aria-label={`${category.name} ${Math.round(category.ratio * 100)}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(category.ratio * 100)} className="ledger-category-progress" role="progressbar">
                <b style={{ backgroundColor: category.color, width: `${category.ratio * 100}%` }} />
              </div>
              <strong>{formatWon(category.amountWon)}</strong>
            </div>
          ))}
          {summary.categories.length === 0 && <div className="ledger-category-empty">{translate("ledger.text.012")}</div>}
        </article>
      </section>

      <section aria-label={translate("ledger.text.013")} className="ledger-list-card">
        {listExpenses.map((expense) => {
          const category = snapshot.categories.find((candidate) => candidate.id === expense.categoryId);
          return (
            <button aria-label={translate("todo.text.030", { value1: expense.title })} className="ledger-expense-row" key={expense.id} onClick={() => openEdit(expense)} type="button">
              <time dateTime={expense.date}>{formatDate(expense.date)}</time>
              <i style={{ backgroundColor: category?.color ?? "oklch(0.645 0.009 106.643)" }} />
              <strong title={expense.title}>{expense.title}</strong>
              <span>{category?.name ?? translate("scrap.text.047")}</span>
              <b>{formatWon(expense.amountWon)}</b>
            </button>
          );
        })}
        {listExpenses.length === 0 && (
          <div className="ledger-empty"><Icon name="wallet" size={26} /><strong>{isCurrentMonth ? translate("dashboard.text.010") : translate("ledger.text.014")}</strong><span>{isCurrentMonth ? translate("ledger.text.015") : translate("ledger.text.016")}</span></div>
        )}
      </section>

      <Modal
        className="ledger-expense-modal"
        footer={<>
          {editingExpenseId && <Button className="ledger-expense-modal__delete" disabled={editorBusy} onClick={() => setDeleteExpenseId(editingExpenseId)} variant="ghost">{translate("settings.text.029")}</Button>}
          <Button disabled={editorBusy} onClick={() => closeModal()}>{translate("scrap.text.025")}</Button>
          <Button form="ledger-expense-form" loading={createMutation.isPending || updateMutation.isPending} type="submit" variant="primary">{translate("settings.text.021")}</Button>
        </>}
        icon="wallet"
        onClose={closeModal}
        open={open}
        title={editingExpenseId ? translate("ledger.text.017") : translate("app.action.newLedger")}
      >
        <form aria-busy={editorBusy} className="ledger-expense-form" id="ledger-expense-form" onSubmit={submit}>
          <label><span>{translate("inbox.text.009")}</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={translate("ledger.text.018")} value={draft.title} /></label>
          <div className="ledger-expense-form__pair">
            <label><span>{translate("inbox.text.010")}</span><LedgerAmountInput onChange={(amountWon) => setDraft((current) => ({ ...current, amountWon }))} value={draft.amountWon} /></label>
            <label><span>{translate("inbox.text.011")}</span><DatePicker align="end" label={translate("inbox.text.011")} onChange={(date) => setDraft((current) => ({ ...current, date }))} value={draft.date} /></label>
          </div>
          <div className="ledger-expense-form__field">
            <div className="ledger-expense-form__category-legend"><span>{translate("scrap.text.040")}</span><button disabled={editorBusy} onClick={openCategoryManager} type="button">{translate("scrap.text.041")}</button></div>
            <Select
              align="end"
              disabled={editorBusy}
              label={translate("scrap.text.040")}
              onChange={(categoryId) => setDraft((current) => ({ ...current, categoryId }))}
              options={snapshot.categories.map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))}
              value={draft.categoryId}
            />
          </div>
          <label><span>{translate("ledger.text.019")}<small>{translate("ledger.text.020")}</small></span><Input maxLength={4_000} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} value={draft.note} /></label>
          {(createMutation.isPending || updateMutation.isPending) && <div className="ledger-mutation-status" role="status"><Icon name="sync" size={13} />{translate("ledger.text.021")}</div>}
          {formError && <div className="ledger-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <Modal
        className="ledger-category-delete-modal"
        footer={<><Button disabled={deleteExpenseMutation.isPending} onClick={() => setDeleteExpenseId(null)}>{translate("scrap.text.025")}</Button><Button loading={deleteExpenseMutation.isPending} onClick={() => deleteExpenseId && deleteExpenseMutation.mutate(deleteExpenseId)} variant="danger">{translate("settings.text.029")}</Button></>}
        icon="alert"
        onClose={() => { if (!deleteExpenseMutation.isPending) setDeleteExpenseId(null); }}
        open={deleteExpenseId !== null}
        title={translate("ledger.text.022")}
      >
        <p><strong>{snapshot.expenses.find((expense) => expense.id === deleteExpenseId)?.title}</strong> {translate("ledger.text.023")}</p>
        {formError && <div className="ledger-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
      </Modal>

      <Modal className="ledger-category-manager-modal" icon="wallet" onClose={closeCategoryManager} open={categoryManagerOpen} title={translate("scrap.text.042")}>
        <div className="ledger-category-manager">
          <div aria-label={translate("inbox.text.018")} className="ledger-category-manager__list">
            {snapshot.categories.map((category, index) => {
              const usageCount = snapshot.expenses.filter((expense) => expense.categoryId === category.id).length;
              return (
                <div className="ledger-category-manager__row" key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <strong>{category.name}</strong>
                  <span>{usageCount}{translate("ledger.text.024")}</span>
                  <div>
                    <IconButton aria-label={translate("todoLabels.text.002", { value1: category.name })} disabled={categoryMutation.isPending || index === 0} onClick={() => moveCategory(index, -1)} size="small" title={translate("todoLabels.text.003")} type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                    <IconButton aria-label={translate("todoLabels.text.004", { value1: category.name })} disabled={categoryMutation.isPending || index === snapshot.categories.length - 1} onClick={() => moveCategory(index, 1)} size="small" title={translate("todoLabels.text.005")} type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                    <IconButton aria-label={translate("scrap.text.045", { value1: category.name })} disabled={categoryMutation.isPending} onClick={() => editCategory(category)} size="small" title={translate("scrap.text.046")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                    <IconButton aria-label={category.id === "other" ? translate("scrap.text.048", { value1: category.name }) : translate("scrap.text.049", { value1: category.name })} disabled={categoryMutation.isPending || category.id === "other"} onClick={() => setDeleteCategoryId(category.id)} size="small" title={category.id === "other" ? translate("scrap.text.050") : translate("settings.text.029")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>

          <form aria-busy={categoryMutation.isPending} className="ledger-category-editor" onSubmit={submitCategory}>
            <div className="ledger-category-editor__header">
              <strong>{editingCategoryId ? translate("scrap.text.051") : translate("scrap.text.052")}</strong>
              {editingCategoryId && <button disabled={categoryMutation.isPending} onClick={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }} type="button">{translate("scrap.text.025")}</button>}
            </div>
            <div className="ledger-category-editor__controls">
              <ColorPicker disabled={categoryMutation.isPending} label={translate("todoLabels.text.008")} onChange={(color) => setCategoryDraft((current) => ({ ...current, color }))} selected value={categoryDraft.color} />
              <Input aria-label={translate("scrap.text.053")} disabled={categoryMutation.isPending} maxLength={100} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder={translate("scrap.text.053")} value={categoryDraft.name} />
              <Button loading={categoryMutation.isPending} type="submit" variant="primary">{editingCategoryId ? translate("settings.text.021") : translate("scrap.text.054")}</Button>
            </div>
            {categoryError && <div className="ledger-mutation-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="ledger-category-delete-modal"
        footer={<><Button disabled={categoryMutation.isPending} onClick={() => setDeleteCategoryId(null)}>{translate("scrap.text.025")}</Button><Button loading={categoryMutation.isPending} onClick={() => deleteCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId })} variant="danger">{translate("settings.text.029")}</Button></>}
        icon="alert"
        onClose={() => { if (!categoryMutation.isPending) setDeleteCategoryId(null); }}
        open={deleteCategoryId !== null}
        title={translate("scrap.text.055")}
      >
        <p>
          <strong>{snapshot.categories.find((category) => category.id === deleteCategoryId)?.name}</strong> {translate("ledger.text.025")}{snapshot.expenses.some((expense) => expense.categoryId === deleteCategoryId) && <> {translate("ledger.text.026")}<strong>{fallbackCategoryName}</strong>{translate("ledger.text.027")}</>}
        </p>
        {categoryError && <div className="ledger-mutation-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
      </Modal>
    </div>
  );
}

function formatWon(amountWon: number) {
  return `₩ ${amountWon.toLocaleString("ko-KR")}`;
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${String(Number(day)).padStart(2, "0")}`;
}

function LedgerLoading() {
  return <div aria-label={translate("ledger.text.028")} className="ledger-page"><section className="ledger-overview"><div className="ledger-total-card ledger-skeleton" /><div className="ledger-category-card ledger-skeleton" /></section><div className="ledger-list-card ledger-skeleton" /></div>;
}
