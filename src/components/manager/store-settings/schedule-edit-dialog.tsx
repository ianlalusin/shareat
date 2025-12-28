
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { MenuSchedule } from "./schedules-settings";

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  days: z.array(z.string()).refine(value => value.some(day => day), {
    message: "You have to select at least one day.",
  }),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)."),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)."),
  isActive: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

interface ScheduleEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues) => void;
  item: MenuSchedule | null;
  isSubmitting: boolean;
}

export function ScheduleEditDialog({ isOpen, onClose, onSave, item, isSubmitting }: ScheduleEditDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", days: [], startTime: "09:00", endTime: "22:00", isActive: true },
  });

  useEffect(() => {
    if (item) {
      form.reset(item);
    } else {
      form.reset({ name: "", days: [], startTime: "09:00", endTime: "22:00", isActive: true });
    }
  }, [item, form, isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? "Edit Schedule" : "Create New Schedule"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} id="schedule-form" className="space-y-4 py-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem><FormLabel>Start Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem><FormLabel>End Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="days" render={() => (
              <FormItem>
                <FormLabel>Active Days</FormLabel>
                <div className="grid grid-cols-4 gap-2 rounded-lg border p-4">
                  {daysOfWeek.map((day) => (
                    <FormField key={day} control={form.control} name="days" render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value?.includes(day)}
                            onCheckedChange={(checked) => {
                              return checked
                                ? field.onChange([...field.value, day])
                                : field.onChange(field.value?.filter((value) => value !== day));
                            }}
                          />
                        </FormControl>
                        <FormLabel className="text-sm font-normal">{day.substring(0,3)}</FormLabel>
                      </FormItem>
                    )} />
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <FormLabel>Active</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="schedule-form" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
