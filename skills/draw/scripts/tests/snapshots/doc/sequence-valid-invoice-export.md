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
| 2 | InvoiceDocumentBuilderService | ExportJob | null | Reply | Only if invoiceId empty |
| 3 | InvoiceDocumentBuilderService | InvoiceRepository | GetInvoice(invoiceId) | Synchronous | Only if invoice cached = false |
| 4 | InvoiceRepository | Database | SELECT invoice | Synchronous | Only if invoice cached = false |
| 5 | InvoiceRepository | InvoiceDocumentBuilderService | invoice | Reply | Only if invoice cached = false |
| 6 | InvoiceDocumentBuilderService | InvoiceRepository | GetLines(invoiceId) | Synchronous | If has lines |
| 7 | InvoiceRepository | InvoiceDocumentBuilderService | lines | Reply | If has lines |
| 8 | InvoiceDocumentBuilderService | ExportJob | document | Reply | Otherwise, if no lines |
