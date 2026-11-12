"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { LedgerChange, LedgerPersonRecord } from "@/lib/ledger";
import { newId } from "./ledgerUi";

export interface PersonChoice {
  /** An existing person's id, "new" to add someone, or "" when nothing is chosen yet. */
  personId: string;
  newName: string;
  newPhone: string;
}

export const EMPTY_PERSON_CHOICE: PersonChoice = { personId: "", newName: "", newPhone: "" };

/**
 * Chooses an existing person or adds a new one. People are reused across groups, expenses and
 * dues, so the list comes first and a name that already exists is never added twice.
 */
export function PersonPicker({
  label = "Person",
  people,
  value,
  onChange,
  excludeIds = [],
  disabled,
}: {
  label?: string;
  people: LedgerPersonRecord[];
  value: PersonChoice;
  onChange: (value: PersonChoice) => void;
  excludeIds?: string[];
  disabled?: boolean;
}) {
  const options = useMemo(
    () => people.filter((person) => !person.archived_at && !excludeIds.includes(person.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [people, excludeIds]
  );
  return (
    <div className="space-y-2">
      <Select
        label={label}
        value={value.personId}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, personId: event.target.value })}
        className="text-base sm:text-sm"
      >
        <option value="">Choose a person</option>
        {options.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
        <option value="new">+ New person</option>
      </Select>
      {value.personId === "new" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="New person's name"
            placeholder="Name"
            value={value.newName}
            maxLength={80}
            onChange={(event) => onChange({ ...value, newName: event.target.value })}
            className="text-base sm:text-sm"
          />
          <Input
            aria-label="New person's phone (optional)"
            placeholder="Phone (optional)"
            inputMode="tel"
            value={value.newPhone}
            maxLength={30}
            onChange={(event) => onChange({ ...value, newPhone: event.target.value })}
            className="text-base sm:text-sm"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Turns a choice into a person id, plus the change that creates the person when they are new.
 * `pending` collects people created earlier in the same save, so typing one name twice adds one.
 */
export function resolvePersonChoice(
  choice: PersonChoice,
  people: LedgerPersonRecord[],
  pending: Map<string, string>
): { id: string; change?: LedgerChange } | { error: string } {
  if (!choice.personId) return { error: "Choose a person." };
  if (choice.personId !== "new") return { id: choice.personId };
  const name = choice.newName.trim();
  if (!name) return { error: "Enter the new person's name." };
  const key = name.toLowerCase();
  const existing = people.find((person) => !person.archived_at && person.name.trim().toLowerCase() === key);
  if (existing) return { id: existing.id };
  const created = pending.get(key);
  if (created) return { id: created };
  const id = newId();
  pending.set(key, id);
  return {
    id,
    change: { entity: "ledger_person", op: "CREATE", id, payload: { name, phone: choice.newPhone.trim(), notes: "", archived_at: null } },
  };
}
