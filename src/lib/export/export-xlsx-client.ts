
"use client";

import { toast } from "@/hooks/use-toast";
import type { WorkBook, WorkSheet } from "xlsx";

/**
 * A client-side helper to export data to an XLSX file.
 * This function dynamically imports the 'xlsx' library to avoid including it
 * in the server-side bundle, which can cause build issues with Next.js.
 *
 * @param {object} params - The parameters for the export.
 * @param {any[]} params.rows - An array of objects to be converted to spreadsheet rows.
 * @param {string} params.sheetName - The name of the worksheet.
 * @param {string} params.filename - The name of the file to be downloaded (including .xlsx extension).
 */
export async function exportToXlsx({
  rows,
  sheetName = "Sheet 1",
  filename = "export.xlsx",
}: {
  rows: any[];
  sheetName?: string;
  filename?: string;
}) {
  if (!rows || rows.length === 0) {
    toast({
      variant: "destructive",
      title: "Export Failed",
      description: "There is no data to export.",
    });
    return;
  }

  try {
    // Dynamically import the xlsx library only on the client-side.
    const XLSX = await import("xlsx");

    const worksheet: WorkSheet = XLSX.utils.json_to_sheet(rows);
    const workbook: WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Trigger the download.
    XLSX.writeFile(workbook, filename);
  } catch (error) {
    console.error("[exportToXlsx] Failed to export:", error);
    toast({
      variant: "destructive",
      title: "Export Failed",
      description: "An unexpected error occurred while generating the file.",
    });
  }
}

    