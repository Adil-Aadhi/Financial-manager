"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { useLedger } from "./LedgerProvider";
import { newId, useLedgerSave } from "./ledgerUi";

/** Add or edit a person. A person with history is archived, not deleted. */
export function PersonFormModal({ personId }: { personId?: string }) {
  const { data, close } = useLedger();
  const online = useOnlineStatus();
  const person = personId ? data.people.find((item) => item.id === personId) ?? null : null;
  const [id] = useState(() => person?.id ?? newId());
  const [name, setName] = useState(person?.name ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const { save, pending, error, setError } = useLedgerSave();

  const hasHistory =
    !!person && (data.members.some((member) => member.person_id === person.id) || data.obligations.some((obligation) => obligation.person_id === person.id));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    save(
      [
        {
          entity: "ledger_person",
          op: person ? "UPDATE" : "CREATE",
          id,
          payload: person ? { name, phone, notes } : { name, phone, notes, archived_at: null },
        },
      ],
      close
    );
  };

  const setArchived = (archived: boolean) =>
    save([{ entity: "ledger_person", op: "UPDATE", id, payload: { archived_at: archived ? new Date().toISOString() : null } }], close);

  return (
    <Modal isOpen onClose={close} title={person ? "Edit person" : "New person"} description="People can be reused in groups, expenses and dues." size="sm">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required className="text-base sm:text-sm" />
        <Input label="Phone (optional)" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} className="text-base sm:text-sm" />
        <Input label="Notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} className="text-base sm:text-sm" />
        <Button type="submit" className="w-full" isLoading={pending}>
          {person ? "Save changes" : "Add person"}
        </Button>
        {person && (
          <div className="flex flex-wrap gap-2">
            {person.archived_at ? (
              <Button type="button" variant="outline" size="sm" leftIcon={<ArchiveRestore className="h-4 w-4" />} onClick={() => setArchived(false)} disabled={pending}>
                Restore
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" leftIcon={<Archive className="h-4 w-4" />} onClick={() => setArchived(true)} disabled={pending}>
                Archive
              </Button>
            )}
            {!hasHistory && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => save([{ entity: "ledger_person", op: "DELETE", id, payload: {} }], close)}
                disabled={pending}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
