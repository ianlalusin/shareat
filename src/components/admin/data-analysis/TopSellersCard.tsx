"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";
import { formatCurrency, formatNumber } from "./formatters";

export function TopSellersCard({ topSellers }: { topSellers: DataAnalysisResult["topSellers"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Sellers</CardTitle>
        <CardDescription>Top 20 by revenue or quantity, across the selected range.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="packages">
          <TabsList>
            <TabsTrigger value="packages">Packages</TabsTrigger>
            <TabsTrigger value="addons">Add-ons</TabsTrigger>
            <TabsTrigger value="refills">Refills</TabsTrigger>
          </TabsList>
          <TabsContent value="packages">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSellers.packages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground text-sm">
                      No package sales in range
                    </TableCell>
                  </TableRow>
                )}
                {topSellers.packages.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(p.qty)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="addons">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSellers.addons.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                      No add-on sales in range
                    </TableCell>
                  </TableRow>
                )}
                {topSellers.addons.map((a) => (
                  <TableRow key={a.name}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.categoryName}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(a.qty)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(a.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="refills">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Qty Served</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSellers.refills.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground text-sm">
                      No refills in range
                    </TableCell>
                  </TableRow>
                )}
                {topSellers.refills.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(r.qty)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
