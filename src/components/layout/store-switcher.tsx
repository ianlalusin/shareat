
'use client'

import * as React from 'react'
import { ChevronsUpDown, Store, PlusCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useAuthContext } from '@/context/auth-context'
import { useStoreContext } from '@/context/store-context'
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

type PopoverTriggerProps = React.ComponentPropsWithoutRef<typeof PopoverTrigger>

interface StoreSwitcherProps extends PopoverTriggerProps {}

export function StoreSwitcher({ className }: StoreSwitcherProps) {
  const { appUser } = useAuthContext();
  const { activeStore, allowedStores, setActiveStore, loading } = useStoreContext();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  
  const handleStoreSelect = async (storeId: string) => {
    setOpen(false);
    if (activeStore?.id === storeId) return;

    try {
        await setActiveStore(storeId);
        const selectedStore = allowedStores.find(s => s.id === storeId);
        toast({
            title: "Store Switched",
            description: `You are now managing ${selectedStore?.name}.`,
        });
    } catch (error) {
        toast({
            variant: 'destructive',
            title: "Error Switching Store",
            description: "Could not update your active store.",
        });
    }
  };
  
  const handleCreateStore = () => {
    setOpen(false);
    router.push('/admin/stores');
  };
  
  if (loading || !appUser || allowedStores.length === 0) {
      // Render a placeholder or null while loading or if no stores are available
      return (
         <Button
          variant="outline"
          role="combobox"
          aria-label="Select a store"
          className={cn('w-[200px] justify-between text-black', className)}
          disabled
        >
          <Store className="mr-2 h-4 w-4" />
          Loading stores...
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      );
  }

  // Hide switcher if there's only one store and the user isn't an admin
  // who might need to create more.
  if (allowedStores.length <= 1 && appUser.role !== 'admin') {
      return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select a store"
          className={cn('w-[200px] justify-between text-black', className)}
        >
          <Store className="mr-2 h-4 w-4" />
          {activeStore ? activeStore.name : "Select a store"}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandList>
            <CommandInput placeholder="Search store..." />
            <CommandEmpty>No store found.</CommandEmpty>
            <CommandGroup heading="Accessible Stores">
              {allowedStores.map((store) => (
                <CommandItem
                  key={store.id}
                  onSelect={() => handleStoreSelect(store.id)}
                  className="text-sm"
                >
                  <Store className="mr-2 h-4 w-4" />
                  {store.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {appUser.role === 'admin' && (
            <>
                <CommandSeparator />
                <CommandList>
                    <CommandGroup>
                    <CommandItem
                        onSelect={handleCreateStore}
                        className="text-destructive hover:text-destructive"
                    >
                        <PlusCircle className="mr-2" />
                        Create Store
                    </CommandItem>
                    </CommandGroup>
                </CommandList>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
