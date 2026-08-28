import { ledgerCategoryWriteInputSchema, ledgerWriteInputSchema, type LedgerCategory, type LedgerCategoryWriteInput, type LedgerWriteInput } from "@mono/contracts";
import { Button, ColorPicker, DatePicker, Icon, IconButton, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { LedgerRepository } from "./ledger-repository";
import { LedgerAmountInput } from "./LedgerAmountInput";
import { summarizeLedgerMonth } from "./ledger-summary";

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
  | { type: "update"; categoryId: string; input: LedgerCategoryWriteInput }
  | { type: "reorder"; categoryIds: string[] }
  | { type: "delete"; categoryId: string };

const blankCategoryDraft: LedgerCategoryWriteInput = { name: "", color: "oklch(0.539 0.082 160.129)" };

function blankDraft(today: string, categories: LedgerCategory[]): Draft {
  return { title: "", amountWon: "", date: today, categoryId: categories[0]?.id ?? "", note: "" };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "지출을 저장하지 못했습니다.";
}

export function LedgerPage({ repository }: { repository: LedgerRepository }) {
  const [draft, setDraft] = useState<Draft>({ title: "", amountWon: "", date: "", categoryId: "", note: "" });
  const [viewMonth, setViewMonth] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
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
  const categoryMutation = useMutation({
    mutationFn: async (command: CategoryCommand) => {
      if (command.type === "create") await repository.createCategory(command.input);
      else if (command.type === "update") await repository.updateCategory(command.categoryId, command.input);
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
    onError: (error) => setCategoryError(errorMessage(error)),
  });

  useEffect(() => {
    const snapshot = snapshotQuery.data;
    if (searchParams.get("modal") !== "new") {
      handledNewParamRef.current = false;
      return;
    }
    if (!snapshot || open || handledNewParamRef.current) return;
    handledNewParamRef.current = true;
    setDraft(blankDraft(snapshot.today, snapshot.categories));
    setFormError(null);
    setOpen(true);
  }, [open, searchParams, snapshotQuery.data]);

  if (snapshotQuery.isPending) return <LedgerLoading />;
  if (snapshotQuery.isError) return <div className="ledger-state" role="alert"><Icon name="alert" size={18} />가계부를 불러오지 못했습니다.</div>;

  const snapshot = snapshotQuery.data;
  const currentMonth = snapshot.today.slice(0, 7);
  const activeMonth = viewMonth ?? currentMonth;
  const isCurrentMonth = activeMonth === currentMonth;
  const summary = summarizeLedgerMonth(snapshot, activeMonth);
  const listExpenses = summary.expenses;
  const [year, month] = activeMonth.split("-").map(Number);
  const fallbackCategoryName = snapshot.categories.find((category) => category.id === "other")?.name ?? "기타";
  // comparison은 서버가 이번 달 기준으로 선계산하므로 다른 달을 볼 때는 표시하지 않는다.
  const comparison = snapshot.comparison.direction === "same"
    ? "지난달 같은 기간과 같음"
    : `지난달 같은 기간보다 ${snapshot.comparison.percentage}% ${snapshot.comparison.direction === "less" ? "적게 씀" : "더 씀"}`;

  function stepMonth(offset: number) {
    const [y, m] = activeMonth.split("-").map(Number);
    const shifted = new Date(y, m - 1 + offset, 1);
    const next = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
    setViewMonth(next === currentMonth ? null : next);
  }

  function closeModal(force = false) {
    if (createMutation.isPending && !force) return;
    setOpen(false);
    setCategoryManagerOpen(false);
    setDeleteCategoryId(null);
    setFormError(null);
    if (searchParams.has("modal")) setSearchParams({}, { replace: true });
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
    setCategoryDraft({ name: category.name, color: category.color });
    setCategoryError(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const parsed = ledgerCategoryWriteInputSchema.safeParse(categoryDraft);
    if (!parsed.success) {
      setCategoryError(parsed.error.issues[0]?.message ?? "라벨 입력값을 확인해야 합니다.");
      return;
    }
    if (editingCategoryId) categoryMutation.mutate({ type: "update", categoryId: editingCategoryId, input: parsed.data });
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
      setFormError(parsed.error.issues[0]?.message ?? "입력값을 확인해야 합니다.");
      return;
    }
    createMutation.mutate(parsed.data);
  }

  return (
    <div className="ledger-page">
      <section className="ledger-overview">
        <article className="ledger-total-card">
          <div className="ledger-month-nav">
            <IconButton aria-label="이전 월" onClick={() => stepMonth(-1)} size="small" type="button" variant="ghost"><Icon name="arrowLeft" size={15} /></IconButton>
            <span className="ledger-month-nav__label">{year}년 {month}월 지출</span>
            <IconButton aria-label="다음 월" disabled={isCurrentMonth} onClick={() => stepMonth(1)} size="small" type="button" variant="ghost"><Icon name="chevronRight" size={15} /></IconButton>
            {!isCurrentMonth && <button className="ledger-month-nav__today" onClick={() => setViewMonth(null)} type="button">이번 달</button>}
          </div>
          <strong className={summary.totalWon >= 1_000_000_000 ? "ledger-total-card__amount--large" : undefined}>{formatWon(summary.totalWon)}</strong>
          {isCurrentMonth && <small>{comparison}</small>}
        </article>
        <article aria-label="라벨별 지출" className="ledger-category-card">
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
          {summary.categories.length === 0 && <div className="ledger-category-empty">이번 달 라벨별 지출이 없습니다.</div>}
        </article>
      </section>

      <section aria-label="지출 목록" className="ledger-list-card">
        {listExpenses.map((expense) => {
          const category = snapshot.categories.find((candidate) => candidate.id === expense.categoryId);
          return (
            <article className="ledger-expense-row" key={expense.id}>
              <time dateTime={expense.date}>{formatDate(expense.date)}</time>
              <i style={{ backgroundColor: category?.color ?? "oklch(0.645 0.009 106.643)" }} />
              <strong title={expense.title}>{expense.title}</strong>
              <span>{category?.name ?? "기타"}</span>
              <b>{formatWon(expense.amountWon)}</b>
            </article>
          );
        })}
        {listExpenses.length === 0 && (
          <div className="ledger-empty"><Icon name="wallet" size={26} /><strong>{isCurrentMonth ? "이번 달 지출이 없습니다" : "이 달 지출이 없습니다"}</strong><span>{isCurrentMonth ? "지출 추가로 첫 내역을 기록하세요." : "다른 달을 살펴보세요."}</span></div>
        )}
      </section>

      <Modal
        className="ledger-expense-modal"
        footer={<><Button disabled={createMutation.isPending} onClick={() => closeModal()}>취소</Button><Button form="ledger-expense-form" loading={createMutation.isPending} type="submit" variant="primary">저장</Button></>}
        icon="wallet"
        onClose={closeModal}
        open={open}
        title="지출 추가"
      >
        <form aria-busy={createMutation.isPending} className="ledger-expense-form" id="ledger-expense-form" onSubmit={submit}>
          <label><span>항목</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="예: 점심값" value={draft.title} /></label>
          <div className="ledger-expense-form__pair">
            <label><span>금액</span><LedgerAmountInput onChange={(amountWon) => setDraft((current) => ({ ...current, amountWon }))} value={draft.amountWon} /></label>
            <label><span>날짜</span><DatePicker align="end" label="날짜" onChange={(date) => setDraft((current) => ({ ...current, date }))} value={draft.date} /></label>
          </div>
          <fieldset>
            <legend className="ledger-expense-form__category-legend"><span>라벨</span><button disabled={createMutation.isPending} onClick={openCategoryManager} type="button">관리</button></legend>
            <Select
              align="end"
              disabled={createMutation.isPending}
              label="라벨"
              onChange={(categoryId) => setDraft((current) => ({ ...current, categoryId }))}
              options={snapshot.categories.map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))}
              value={draft.categoryId}
            />
          </fieldset>
          <label><span>메모 <small>(선택)</small></span><Input maxLength={4_000} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} value={draft.note} /></label>
          {createMutation.isPending && <div className="ledger-mutation-status" role="status"><Icon name="sync" size={13} />지출을 저장하고 있습니다.</div>}
          {formError && <div className="ledger-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <Modal className="ledger-category-manager-modal" icon="wallet" onClose={closeCategoryManager} open={categoryManagerOpen} title="라벨 관리">
        <div className="ledger-category-manager">
          <div aria-label="가계부 라벨" className="ledger-category-manager__list">
            {snapshot.categories.map((category, index) => {
              const usageCount = snapshot.expenses.filter((expense) => expense.categoryId === category.id).length;
              return (
                <div className="ledger-category-manager__row" key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <strong>{category.name}</strong>
                  <span>{usageCount}건</span>
                  <div>
                    <IconButton aria-label={`${category.name} 위로 이동`} disabled={categoryMutation.isPending || index === 0} onClick={() => moveCategory(index, -1)} size="small" title="위로 이동" type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                    <IconButton aria-label={`${category.name} 아래로 이동`} disabled={categoryMutation.isPending || index === snapshot.categories.length - 1} onClick={() => moveCategory(index, 1)} size="small" title="아래로 이동" type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                    <IconButton aria-label={`${category.name} 편집`} disabled={categoryMutation.isPending} onClick={() => editCategory(category)} size="small" title="편집" type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                    <IconButton aria-label={category.id === "other" ? `${category.name} 삭제 불가` : `${category.name} 삭제`} disabled={categoryMutation.isPending || category.id === "other"} onClick={() => setDeleteCategoryId(category.id)} size="small" title={category.id === "other" ? "기타 라벨은 삭제할 수 없습니다" : "삭제"} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>

          <form aria-busy={categoryMutation.isPending} className="ledger-category-editor" onSubmit={submitCategory}>
            <div className="ledger-category-editor__header">
              <strong>{editingCategoryId ? "라벨 수정" : "새 라벨"}</strong>
              {editingCategoryId && <button disabled={categoryMutation.isPending} onClick={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }} type="button">취소</button>}
            </div>
            <div className="ledger-category-editor__controls">
              <ColorPicker disabled={categoryMutation.isPending} label="라벨 색상" onChange={(color) => setCategoryDraft((current) => ({ ...current, color }))} selected value={categoryDraft.color} />
              <Input aria-label="라벨 이름" disabled={categoryMutation.isPending} maxLength={100} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="라벨 이름" value={categoryDraft.name} />
              <Button loading={categoryMutation.isPending} type="submit" variant="primary">{editingCategoryId ? "저장" : "추가"}</Button>
            </div>
            {categoryError && <div className="ledger-mutation-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="ledger-category-delete-modal"
        footer={<><Button disabled={categoryMutation.isPending} onClick={() => setDeleteCategoryId(null)}>취소</Button><Button loading={categoryMutation.isPending} onClick={() => deleteCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId })} variant="danger">삭제</Button></>}
        icon="alert"
        onClose={() => { if (!categoryMutation.isPending) setDeleteCategoryId(null); }}
        open={deleteCategoryId !== null}
        title="라벨 삭제"
      >
        <p>
          <strong>{snapshot.categories.find((category) => category.id === deleteCategoryId)?.name}</strong> 라벨을 삭제할까요?
          {snapshot.expenses.some((expense) => expense.categoryId === deleteCategoryId) && <> 이 라벨의 기존 지출은 모두 <strong>{fallbackCategoryName}</strong>로 이동합니다.</>}
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
  return <div aria-label="가계부 불러오는 중" className="ledger-page"><section className="ledger-overview"><div className="ledger-total-card ledger-skeleton" /><div className="ledger-category-card ledger-skeleton" /></section><div className="ledger-list-card ledger-skeleton" /></div>;
}
