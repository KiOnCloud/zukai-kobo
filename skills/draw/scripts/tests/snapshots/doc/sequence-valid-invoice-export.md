<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Invoice export

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | ExportJob | Control |
| 2 | InvoiceDocumentBuilderService | Control |
| 3 | InvoiceRepository | Participant |
| 4 | Database | Database |

## Steps

| No. | From | To | Message | Kind | Condition |
| --- | --- | --- | --- | --- | --- |
| 1 | ExportJob | InvoiceDocumentBuilderService | Build(invoiceId) | Synchronous | — |
| 2 | InvoiceDocumentBuilderService | ExportJob | null | Reply | opt: invoiceId empty |
| 3 | InvoiceDocumentBuilderService | InvoiceRepository | GetInvoice(invoiceId) | Synchronous | opt: invoice cached = false |
| 4 | InvoiceRepository | Database | SELECT invoice | Synchronous | opt: invoice cached = false |
| 5 | InvoiceRepository | InvoiceDocumentBuilderService | invoice | Reply | opt: invoice cached = false |
| 6 | InvoiceDocumentBuilderService | InvoiceRepository | GetLines(invoiceId) | Synchronous | alt: has lines |
| 7 | InvoiceRepository | InvoiceDocumentBuilderService | lines | Reply | alt: has lines |
| 8 | InvoiceDocumentBuilderService | ExportJob | document | Reply | alt else: no lines |
