"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DataAnalysisResult, DayRow, MonthRow } from "@/hooks/use-data-analysis";
import { formatCurrency, formatNumber } from "./formatters";

const DAY_FMT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", weekday: "short" });

function DayTable({ rows, title }: { rows: DayRow[]; title: string }) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{title}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Net Sales</TableHead>
            <TableHead className="text-right">Txns</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground text-center text-sm">No data</TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.dayId}>
              <TableCell>{DAY_FMT.format(r.date)}</TableCell>
              <TableCell className="text-right font-mono">{formatCurrency(r.net)}</TableCell>
              <TableCell className="text-right font-mono">{formatNumber(r.tx)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MonthTable({ rows, title }: { rows: MonthRow[]; title: string }) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{title}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Net Sales</TableHead>
            <TableHead className="text-right">Txns</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground text-center text-sm">No data</TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.monthId}>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right font-mono">{formatCurrency(r.net)}</TableCell>
              <TableCell className="text-right font-mono">{formatNumber(r.tx)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function BestWorstCard({ bestWorst }: { bestWorst: DataAnalysisResult["bestWorst"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Best & Worst</CardTitle>
        <CardDescription>Top and bottom days and months by net sales.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <DayTable rows={bestWorst.days.best} title="Best 5 Days" />
        <DayTable rows={bestWorst.days.worst} title="Worst 5 Days" />
        <MonthTable rows={bestWorst.months.best} title="Best 5 Months" />
        <MonthTable rows={bestWorst.months.worst} title="Worst 5 Months" />
      </CardContent>
    </Card>
  );
}
