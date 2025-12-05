import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Store } from "lucide-react";

export function StoreSelector() {
  return (
    <Select defaultValue="store1">
      <SelectTrigger className="w-full md:w-[200px] lg:w-[240px] bg-transparent border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 focus:ring-accent data-[state=open]:bg-primary-foreground/10">
        <div className="flex items-center gap-2">
            <Store className="h-4 w-4" />
            <SelectValue placeholder="Select a store" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="store1">Main Street Branch</SelectItem>
        <SelectItem value="store2">Downtown Cafe</SelectItem>
        <SelectItem value="store3">Uptown Diner</SelectItem>
      </SelectContent>
    </Select>
  );
}
