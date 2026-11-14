"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ExportReportModal } from "@/components/reports/ExportReportModal";
import { prefetchExporters } from "@/lib/reportExport/runExport";

/** "Export" action in the Reports page header. Export libraries load only when it's used. */
export function ExportReportButton({ ownerId, defaultCurrency }: { ownerId: string; defaultCurrency: string }) {
  const [isOpen, setIsOpen] = useState(false);
  // Mount the modal (and its IndexedDB queries) only once the user first asks for it.
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<Download className="h-3.5 w-3.5" />}
        onClick={() => {
          setHasOpened(true);
          setIsOpen(true);
          // While online, fetch the PDF/Excel engines so the service worker caches them for
          // offline exports later. Offline, this quietly does nothing.
          if (navigator.onLine) prefetchExporters();
        }}
      >
        Export
      </Button>
      {hasOpened && (
        <ExportReportModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          ownerId={ownerId}
          defaultCurrency={defaultCurrency}
        />
      )}
    </>
  );
}
