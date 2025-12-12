
'use client';

import { useState, useEffect, useReducer, useMemo, Fragment } from 'react';
import { useParams, notFound, useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useAuthContext } from '@/context/auth-context';
import {
  doc,
  onSnapshot,
  collection,
  updateDoc,
  query,
  where,
  addDoc,
  serverTimestamp,
  runTransaction,
  deleteDoc,
} from 'firebase/firestore';
import { Order, OrderItem, CollectionItem, OrderTransaction, Store, PendingOrderUpdate, OrderUpdateLog, DiscountType } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, X, Check, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaymentModal } from '@/components/cashier/payment-modal';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSyncStatus } from '@/hooks/use-sync-status';


// Reducer for complex state management of TIN input
const tinReducer = (state: any, action: any) => {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, inputValue: action.payload };
    case 'SET_SAVED':
      return { ...state, savedValue: action.payload };
    case 'SET_ALL':
        const formatted = formatTIN(action.payload.saved || '');
      return { inputValue: formatted, savedValue: action.payload.saved || '' };
    default:
      return state;
  }
};

const formatTIN = (value: string): string => {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  return [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 9),
  ]
    .filter(Boolean)
    .join('-')
    .slice(0, 11);
};

const unformatTIN = (value: string) => {
    return value.replace(/-/g, '');
}

type OrderTaxSummary = {
  vatableNet: number;        // Net of VAT and discounts
  vatAmount: number;         // VAT portion
  vatableGross: number;      // Net + VAT
  exemptSales: number;       // Non-VAT / exempt
  totalSalesBeforeCharges: number; // For cross-checking vs grand total
};


export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [transactions, setTransactions] = useState<OrderTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');

  const [tin, dispatch] = useReducer(tinReducer, {
    inputValue: '',
    savedValue: '',
  });

  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState<'₱' | '%'>('₱');
  const [selectedDiscount, setSelectedDiscount] = useState('');
  const [discountTypes, setDiscountTypes] = useState<DiscountType[]>([]);
  
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [chargeValue, setChargeValue] = useState('');
  const [selectedCharge, setSelectedCharge] = useState('');
  const [customChargeType, setCustomChargeType] = useState('');
  const [chargeTypes, setChargeTypes] = useState<CollectionItem[]>([]);
  
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineDiscountType, setLineDiscountType] = useState<'₱' | '%'>('₱');
  const [lineDiscountValueInput, setLineDiscountValueInput] = useState('');
  const [selectedLineDiscountCode, setSelectedLineDiscountCode] = useState<string>('');


  const firestore = useFirestore();
  const { user } = useAuthContext();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const { hasPendingWrites } = useSyncStatus();

  useEffect(() => {
    if (!firestore || !orderId) return;

    const orderRef = doc(firestore, 'orders', orderId);
    const orderUnsubscribe = onSnapshot(orderRef, (docSnap) => {
      if (docSnap.exists()) {
        const orderData = { id: docSnap.id, ...docSnap.data() } as Order;
        setOrder(orderData);
        setCustomerName(orderData.customerName || '');
        setAddress(orderData.address || '');
        dispatch({ type: 'SET_ALL', payload: { saved: orderData.tin || '' }});

      } else {
        setOrder(null);
      }
      setLoading(false);
    });

    const itemsRef = collection(firestore, 'orders', orderId, 'orderItems');
    const itemsUnsubscribe = onSnapshot(itemsRef, (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OrderItem));
        setOrderItems(itemsData);
    });
    
    const transactionsQuery = query(collection(firestore, 'orders', orderId, 'transactions'));
    const transactionsUnsubscribe = onSnapshot(transactionsQuery, (snapshot) => {
        const transData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OrderTransaction));
        setTransactions(transData);
    });
    
    return () => {
      orderUnsubscribe();
      itemsUnsubscribe();
      transactionsUnsubscribe();
    };
  }, [firestore, orderId]);
  
  useEffect(() => {
    if (firestore && order?.storeId) {
      const storeRef = doc(firestore, 'stores', order.storeId);
      const storeUnsubscribe = onSnapshot(storeRef, (docSnap) => {
        if(docSnap.exists()){
          setStore({ id: docSnap.id, ...docSnap.data() } as Store);
        }
      });
      
      const discountsQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'discount type'),
        where('is_active', '==', true),
        where('storeIds', 'array-contains', order.storeId)
      );

      const discountsUnsubscribe = onSnapshot(discountsQuery, (snapshot) => {
        const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DiscountType));
        setDiscountTypes(types);
      });
      
      const chargesQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'charge type'),
        where('is_active', '==', true),
        where('storeIds', 'array-contains', order.storeId)
      );
      const chargesUnsubscribe = onSnapshot(chargesQuery, (snapshot) => {
        const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CollectionItem));
        setChargeTypes(types);
      });

      return () => {
        storeUnsubscribe();
        discountsUnsubscribe();
        chargesUnsubscribe();
      }
    }
  }, [firestore, order?.storeId]);

  useEffect(() => {
    console.log('discountTypes:', discountTypes);
  }, [discountTypes]);

  const lineDiscountTypes = useMemo(
    () =>
      discountTypes.filter((d) =>
        !d.appliesTo || d.appliesTo === 'line' || d.appliesTo === 'both'
      ),
    [discountTypes]
  );
  
  const billableItems = useMemo(() => {
    return orderItems.filter((item) => {
      const price = item.priceAtOrder ?? 0;
      const isFree = item.isFree === true || price === 0;

      const statusOk =
        item.status === 'Served' ||
        item.status === 'Completed'; // allow completed items too if present

      return !isFree && statusOk;
    });
  }, [orderItems]);

  const subtotal = useMemo(
    () =>
      billableItems.reduce((acc, item) => {
        const price = item.priceAtOrder ?? 0;
        const qty = item.quantity ?? 0;
        const base = price * qty;
        const discount = item.lineDiscountAmount ?? 0;
        const lineTotal = Math.max(0, base - discount);
        return acc + lineTotal;
      }, 0),
    [billableItems]
  );

  const netSubtotalForDiscount = useMemo(() => {
    return billableItems.reduce((acc, item) => {
      const price = item.priceAtOrder ?? 0;
      const qty = item.quantity ?? 0;
      const grossLine = price * qty;
  
      const taxRate =
        typeof item.taxRate === 'number'
          ? item.taxRate
          : 0;
  
      const isTaxInclusive =
        item.isTaxInclusive !== false; // default true if not specified
  
      const netLine =
        taxRate > 0 && isTaxInclusive
          ? grossLine / (1 + taxRate) // back out VAT
          : grossLine;                // non-vatable or tax-exclusive
  
      return acc + netLine;
    }, 0);
  }, [billableItems]);

  const taxSummary: OrderTaxSummary = useMemo(() => {
    if (!billableItems.length) {
      return {
        vatableNet: 0,
        vatAmount: 0,
        vatableGross: 0,
        exemptSales: 0,
        totalSalesBeforeCharges: 0,
      };
    }
  
    // Split VATable vs Exempt based on taxRate
    const vatableItems = billableItems.filter(
      (item) => typeof item.taxRate === 'number' && (item.taxRate ?? 0) > 0
    );
    const exemptItems = billableItems.filter(
      (item) => !item.taxRate || (item.taxRate ?? 0) === 0
    );
  
    const grossVatable = vatableItems.reduce((acc, item) => {
      const price = item.priceAtOrder ?? 0;
      const qty = item.quantity ?? 0;
      return acc + price * qty;
    }, 0);
  
    const grossExempt = exemptItems.reduce((acc, item) => {
      const price = item.priceAtOrder ?? 0;
      const qty = item.quantity ?? 0;
      return acc + price * qty;
    }, 0);
  
    if (vatableItems.length === 0) {
      // No VATable items, everything is exempt
      return {
        vatableNet: 0,
        vatAmount: 0,
        vatableGross: 0,
        exemptSales: grossExempt,
        totalSalesBeforeCharges: grossExempt,
      };
    }
  
    // Assume same VAT rate across all VATable items (e.g. 0.12)
    const vatRate = vatableItems[0].taxRate ?? 0;
  
    // Prices are VAT-inclusive → back out VAT to get net
    const vatableNetBeforeDiscount = grossVatable / (1 + vatRate);
  
    // Sum all discounts (order-level) as reducing VATable net first
    const totalDiscount = transactions
      .filter((t) => t.type === 'Discount')
      .reduce((acc, t) => acc + (t.amount ?? 0), 0);
  
    const vatableNet = Math.max(0, vatableNetBeforeDiscount - totalDiscount);
    const vatAmount = vatableNet * vatRate;
    const vatableGross = vatableNet + vatAmount;
  
    const totalSalesBeforeCharges = vatableGross + grossExempt;
  
    return {
      vatableNet,
      vatAmount,
      vatableGross,
      exemptSales: grossExempt,
      totalSalesBeforeCharges,
    };
  }, [billableItems, transactions]);

  const grandTotal = useMemo(() => {
    const rawTotal = transactions.reduce((acc, trans) => {
      if (trans.type === 'Discount') {
        return acc - trans.amount;
      }
      if (trans.type === 'Charge') {
        return acc + trans.amount;
      }
      // 'Payment' types will be handled separately
      return acc;
    }, subtotal);

    return Math.max(0, rawTotal);
  }, [subtotal, transactions]);

  const handleTinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    const digits = unformatTIN(input);

    if (/^\d*$/.test(digits) && digits.length <= 9) {
      const formatted = formatTIN(digits);
      dispatch({ type: 'SET_INPUT', payload: formatted });
    }
  };
  
  const handleDetailsUpdate = async (field: 'customerName' | 'address' | 'tin') => {
    if (!firestore || !order) return;
    const orderRef = doc(firestore, 'orders', order.id);
    let dataToUpdate: Partial<Order> = {};

    if (field === 'tin') {
        const unformattedTin = unformatTIN(tin.inputValue);
        if(unformattedTin !== tin.savedValue && (unformattedTin.length === 9 || unformattedTin.length === 0)) {
            dataToUpdate.tin = unformattedTin;
            dispatch({ type: 'SET_SAVED', payload: unformattedTin });
        } else if (unformattedTin.length > 0 && unformattedTin.length < 9) {
            // Revert to saved value if input is invalid and blurred
            dispatch({ type: 'SET_INPUT', payload: formatTIN(tin.savedValue) });
            return;
        }
    } else if (field === 'customerName' && customerName !== order.customerName) {
        dataToUpdate.customerName = customerName;
    } else if (field === 'address' && address !== order.address) {
        dataToUpdate.address = address;
    }

    if (Object.keys(dataToUpdate).length > 0) {
        try {
            await updateDoc(orderRef, dataToUpdate);
            toast({
              title: "Success!",
              description: "Customer details updated.",
            });
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Update Failed',
                description: 'Could not update customer details.',
            });
        }
    }
  };

  const handleDiscountSelectChange = (value: string) => {
    setSelectedDiscount(value);
    const discountInfo = discountTypes.find(d => d.item === value);
    if(discountInfo) {
      setDiscountType(discountInfo.discountMode === 'ABS' ? '₱' : '%');
      setDiscountValue(String(discountInfo.discountValue || ''));
    }
  }
  
  const handleApplyDiscount = async () => {
    if (!firestore || !order || !discountValue || !selectedDiscount) {
        toast({
            variant: 'destructive',
            title: 'Missing Information',
            description: 'Please enter a value and select a discount type.',
        });
        return;
    }

    const discountInfo = discountTypes.find(d => d.item === selectedDiscount);
    if (discountInfo) {
      if(discountInfo.requiresName && !order.customerName) {
        toast({ variant: 'destructive', title: 'Name Required', description: `The ${discountInfo.item} discount requires a customer name.` });
        return;
      }
      if(discountInfo.requiresTin && !order.tin) {
        toast({ variant: 'destructive', title: 'TIN Required', description: `The ${discountInfo.item} discount requires a TIN.` });
        return;
      }
    }

    const value = parseFloat(discountValue);
    let amount = 0;

    if (discountType === '₱') {
        amount = value;
    } else { // It's '%'
        if (value <= 0 || value > 100) {
            toast({
                variant: 'destructive',
                title: 'Invalid Percentage',
                description: 'Discount percentage must be between 1 and 100.',
            });
            return;
        }
        amount = (netSubtotalForDiscount * value) / 100;
    }

    if (amount <= 0) {
        toast({
            variant: 'destructive',
            title: 'Invalid Amount',
            description: 'Discount amount must be positive.',
        });
        return;
    }

    const newTransaction: Omit<OrderTransaction, 'id'> = {
        orderId: order.id,
        storeId: order.storeId,
        type: 'Discount',
        amount: amount,
        notes: selectedDiscount,
        discountCode: discountInfo?.code || undefined,
        timestamp: serverTimestamp(),
    };

    try {
        await addDoc(collection(firestore, 'orders', order.id, 'transactions'), newTransaction);
        // Reset form
        setDiscountValue('');
        setSelectedDiscount('');
        setShowDiscountForm(false);
        toast({
          title: "Success!",
          description: "Discount has been applied.",
        });
    } catch (error) {
        toast({
            variant: 'destructive',
            title: 'Apply Failed',
            description: 'Failed to apply discount.',
        });
    }
  };

  const handleApplyCharge = async () => {
    if (!firestore || !order || !chargeValue) {
        toast({
            variant: 'destructive',
            title: 'Missing Amount',
            description: 'Please enter a charge amount.',
        });
        return;
    }
    const chargeName = chargeTypes.length > 0 ? selectedCharge : customChargeType;
    if (!chargeName) {
        toast({
            variant: 'destructive',
            title: 'Missing Type',
            description: 'Please select or enter a charge type.',
        });
        return;
    }
    const amount = parseFloat(chargeValue);
    if (amount <= 0) {
        toast({
            variant: 'destructive',
            title: 'Invalid Amount',
            description: 'Charge amount must be positive.',
        });
        return;
    }
    const newTransaction: Omit<OrderTransaction, 'id'> = {
        orderId: order.id,
        storeId: order.storeId,
        type: 'Charge',
        amount: amount,
        notes: chargeName,
        timestamp: serverTimestamp(),
    };
    try {
        await addDoc(collection(firestore, 'orders', order.id, 'transactions'), newTransaction);
        setChargeValue('');
        setSelectedCharge('');
        setCustomChargeType('');
        setShowChargeForm(false);
        toast({
          title: "Success!",
          description: "Charge has been applied.",
        });
    } catch (error) {
        toast({
            variant: 'destructive',
            title: 'Apply Failed',
            description: 'Failed to apply charge.',
        });
    }
  };
  
  const handleFinalizeSuccess = () => {
    setIsPaymentModalOpen(false);
    toast({
      title: "Bill Finalized!",
      description: "The order has been completed.",
    });
    router.push('/cashier');
  };

  const handleToggleLineFree = async (item: OrderItem) => {
    if (!firestore || !order) return;

    const itemRef = doc(firestore, 'orders', order.id, 'orderItems', item.id);
    const newIsFree = !item.isFree;

    try {
      await updateDoc(itemRef, { isFree: newIsFree });
      toast({
        title: 'Updated',
        description: newIsFree
          ? `${item.menuName} marked as free.`
          : `${item.menuName} marked as billable.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Could not update free/gift status.',
      });
    }
  };

  const handleApplyLineDiscount = async (item: OrderItem) => {
    if (!firestore || !order) return;
    if (!lineDiscountValueInput) {
      toast({
        variant: 'destructive',
        title: 'Missing Value',
        description: 'Please enter a discount value.',
      });
      return;
    }
  
    const raw = parseFloat(lineDiscountValueInput);
    if (isNaN(raw) || raw <= 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid Value',
        description: 'Discount must be a positive number.',
      });
      return;
    }
  
    const price = item.priceAtOrder ?? 0;
    const qty = item.quantity ?? 0;
    const base = price * qty;
  
    let discountAmount = 0;
    let discountTypeInternal: 'ABS' | 'PCT' = 'ABS';
  
    if (lineDiscountType === '₱') {
      discountAmount = raw;
      discountTypeInternal = 'ABS';
    } else {
      if (raw <= 0 || raw > 100) {
        toast({
          variant: 'destructive',
          title: 'Invalid Percentage',
          description: 'Discount percentage must be between 1 and 100.',
        });
        return;
      }
      discountAmount = (base * raw) / 100;
      discountTypeInternal = 'PCT';
    }
  
    discountAmount = Math.min(discountAmount, base);
  
    const selected = lineDiscountTypes.find(
      (d) =>
        d.code === selectedLineDiscountCode || d.item === selectedLineDiscountCode
    );
  
    const itemRef = doc(
      firestore,
      'orders',
      order.id,
      'orderItems',
      item.id
    );
  
    try {
      await updateDoc(itemRef, {
        lineDiscountType: discountTypeInternal,
        lineDiscountValue: raw,
        lineDiscountAmount: discountAmount,
        lineDiscountCode: selected?.code ?? null,
        lineDiscountLabel: selected?.item ?? null,
      });
      toast({
        title: 'Line Discount Applied',
        description: `Discount applied to ${item.menuName}.`,
      });
      setEditingLineId(null);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Could not apply line discount.',
      });
    }
  };
  
  const handleClearLineDiscount = async (item: OrderItem) => {
    if (!firestore || !order) return;

    const itemRef = doc(firestore, 'orders', order.id, 'orderItems', item.id);

    try {
      await updateDoc(itemRef, {
        lineDiscountType: null,
        lineDiscountValue: null,
        lineDiscountAmount: null,
        lineDiscountCode: null,
        lineDiscountLabel: null,
      });
      toast({
        title: 'Line Discount Removed',
        description: `Discount removed from ${item.menuName}.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Could not remove line discount.',
      });
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="grid md:grid-cols-3 gap-6">
            <div className='md:col-span-2 space-y-6'>
                 <Skeleton className="h-48 w-full" />
                 <Skeleton className="h-64 w-full" />
            </div>
            <div className='space-y-6'>
                <Skeleton className="h-96 w-full" />
            </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return notFound();
  }
  
  const orderDate = order.orderTimestamp?.toDate();


  return (
    <>
    <main className="flex-1 p-4 lg:p-6">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back</span>
        </Button>
        <div>
            <h1 className="text-2xl font-semibold font-headline">Billing Summary</h1>
        </div>
      </div>
      
       <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Billing Summary</CardTitle>
                    <CardDescription>Only items marked as "Served" are included in the bill.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-center">Qty</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {billableItems.map((item) => {
                              const baseTotal = (item.priceAtOrder ?? 0) * (item.quantity ?? 0);
                              const lineTotal = Math.max(0, baseTotal - (item.lineDiscountAmount ?? 0));
                              const isEditing = editingLineId === item.id;

                              return (
                                <Fragment key={item.id}>
                                  <TableRow>
                                    <TableCell className="font-medium">
                                      {item.menuName}
                                      {item.lineDiscountAmount ? (
                                        <p className="text-xs text-green-600">
                                          Discount: -{formatCurrency(item.lineDiscountAmount)}
                                        </p>
                                      ) : null}
                                    </TableCell>
                                    <TableCell className="text-center">{item.quantity}</TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(item.priceAtOrder ?? 0)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(lineTotal)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Button
                                        size="sm"
                                        variant={isEditing ? 'secondary' : 'outline'}
                                        onClick={() => {
                                          if (isEditing) {
                                            setEditingLineId(null);
                                          } else {
                                            setEditingLineId(item.id);
                                            setSelectedLineDiscountCode('');
                                            setLineDiscountType(item.lineDiscountType === 'PCT' ? '%' : '₱');
                                            setLineDiscountValueInput(
                                              item.lineDiscountValue ? String(item.lineDiscountValue) : ''
                                            );
                                          }
                                        }}
                                      >
                                        {isEditing ? 'Close' : 'Adjust'}
                                      </Button>
                                    </TableCell>
                                  </TableRow>

                                  {isEditing && (
                                    <TableRow>
                                      <TableCell colSpan={5}>
                                        <div className="flex flex-col gap-3 p-3 bg-muted/40 rounded-md">
                                          {/* Free / gift toggle */}
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">Give as Free / Gift</span>
                                            <Button
                                              size="sm"
                                              variant={item.isFree ? 'secondary' : 'outline'}
                                              onClick={() => handleToggleLineFree(item)}
                                            >
                                              {item.isFree ? 'Mark as Paid' : 'Mark as Free'}
                                            </Button>
                                          </div>

                                          <Separator />

                                          <div className="flex flex-col gap-2">
                                            <div className="flex flex-wrap items-stretch gap-2">
                                                {/* Discount type dropdown */}
                                                <Select
                                                value={selectedLineDiscountCode}
                                                onValueChange={(code) => {
                                                    setSelectedLineDiscountCode(code);
                                                    const selected = lineDiscountTypes.find(
                                                    (d) => d.code === code || d.item === code
                                                    );
                                                    if (selected) {
                                                    if (selected.discountMode === 'PCT') {
                                                        setLineDiscountType('%');
                                                    } else if (selected.discountMode === 'ABS') {
                                                        setLineDiscountType('₱');
                                                    }
                                                    if (typeof selected.discountValue === 'number') {
                                                        setLineDiscountValueInput(String(selected.discountValue));
                                                    } else {
                                                        // leave as-is if discountValue is not defined
                                                    }
                                                    }
                                                }}
                                                >
                                                <SelectTrigger className="w-full sm:w-56">
                                                    <SelectValue placeholder="Select discount type (optional)" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {lineDiscountTypes.map((d) => (
                                                    <SelectItem
                                                        key={d.id}
                                                        value={d.code || d.item}
                                                    >
                                                        {d.item}
                                                    </SelectItem>
                                                    ))}
                                                </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Value + ₱/% toggle + buttons */}
                                            <div className="flex flex-wrap items-stretch gap-2">
                                                <div className="flex flex-auto">
                                                <Input
                                                    type="number"
                                                    value={lineDiscountValueInput}
                                                    onChange={(e) => setLineDiscountValueInput(e.target.value)}
                                                    placeholder="Discount value"
                                                    className="rounded-r-none focus-visible:ring-offset-0"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="rounded-l-none border-l-0 px-3 font-bold"
                                                    onClick={() =>
                                                    setLineDiscountType((prev) => (prev === '₱' ? '%' : '₱'))
                                                    }
                                                >
                                                    {lineDiscountType}
                                                </Button>
                                                </div>
                                                <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => handleApplyLineDiscount(item)}
                                                >
                                                Apply Line Discount
                                                </Button>
                                                <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => handleClearLineDiscount(item)}
                                                >
                                                <X className="h-4 w-4" />
                                                <span className="sr-only">Clear line discount</span>
                                                </Button>
                                            </div>
                                            </div>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </Fragment>
                              );
                            })}
                             {billableItems.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">No served items to bill yet.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
                <CardFooter className="flex flex-col items-stretch gap-2">
                     <div className="flex flex-col items-end gap-2 w-full max-w-sm self-end">
                       {transactions.filter(t => t.type !== 'Payment').map(trans => (
                         <div key={trans.id} className="flex justify-between w-full text-sm">
                           <span className="text-muted-foreground">{trans.type}: {trans.notes}</span>
                           <span className={trans.type === 'Discount' ? 'text-green-600' : 'text-destructive'}>
                             {trans.type === 'Discount' ? '-' : ''}{formatCurrency(trans.amount)}
                           </span>
                         </div>
                       ))}
                        <div className="flex justify-between w-full">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="font-medium">{formatCurrency(subtotal)}</span>
                        </div>
                        {/* BIR-style Tax Summary */}
                        {taxSummary.totalSalesBeforeCharges > 0 && (
                          <div className="mt-3 space-y-1 w-full max-w-sm self-end text-sm">
                            {taxSummary.vatableNet > 0 && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">VATable Sales</span>
                                  <span>{formatCurrency(taxSummary.vatableNet)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">VAT Amount (12%)</span>
                                  <span>{formatCurrency(taxSummary.vatAmount)}</span>
                                </div>
                              </>
                            )}
                            {taxSummary.exemptSales > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">VAT-Exempt Sales</span>
                                <span>{formatCurrency(taxSummary.exemptSales)}</span>
                              </div>
                            )}
                          </div>
                        )}
                    </div>

                    <div className="space-y-2 py-2 w-full">
                        {!showDiscountForm && !showChargeForm && (
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setShowDiscountForm(true)}>
                                    <Plus className="mr-2 h-4 w-4" /> Add Discount
                                </Button>
                                <Button variant="outline" onClick={() => setShowChargeForm(true)}>
                                    <Plus className="mr-2 h-4 w-4" /> Add Charge
                                </Button>
                            </div>
                        )}
                        {showDiscountForm && (
                           <div className="flex items-stretch gap-2 rounded-lg border p-2 w-full">
                                <Label htmlFor="discount-value" className="sr-only">Value</Label>
                               <div className="flex flex-auto">
                                    <Input 
                                        id="discount-value"
                                        type="number"
                                        value={discountValue}
                                        onChange={(e) => setDiscountValue(e.target.value)}
                                        placeholder="Value"
                                        className="rounded-r-none focus-visible:ring-offset-0"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="rounded-l-none border-l-0 px-3 font-bold"
                                        onClick={() => setDiscountType(prev => prev === '₱' ? '%' : '₱')}
                                    >
                                        {discountType}
                                    </Button>
                               </div>
                               
                               <Label htmlFor="discount-type" className="sr-only">Type</Label>
                                <Select value={selectedDiscount} onValueChange={handleDiscountSelectChange}>
                                    <SelectTrigger id="discount-type" className="flex-auto">
                                        <SelectValue placeholder="Type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {discountTypes.map(d => <SelectItem key={d.id} value={d.item}>{d.item}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Button type="button" size="sm" className="flex-none" onClick={handleApplyDiscount}>Apply</Button>
                                <Button type="button" size="icon" variant="ghost" className="flex-none" onClick={() => setShowDiscountForm(false)}>
                                    <X className="h-4 w-4"/>
                                    <span className="sr-only">Cancel</span>
                                </Button>
                            </div>
                        )}
                        {showChargeForm && (
                            <div className="flex items-stretch gap-2 rounded-lg border p-2 w-full">
                               <Label htmlFor="charge-value" className="sr-only">Value</Label>
                               <Input 
                                    id="charge-value"
                                    type="number"
                                    value={chargeValue}
                                    onChange={(e) => setChargeValue(e.target.value)}
                                    placeholder="Amount"
                                    className="focus-visible:ring-offset-0 flex-auto"
                                />
                               <Label htmlFor="charge-type" className="sr-only">Type</Label>
                               {chargeTypes.length > 0 ? (
                                 <Select value={selectedCharge} onValueChange={setSelectedCharge}>
                                     <SelectTrigger id="charge-type" className="flex-auto">
                                         <SelectValue placeholder="Type" />
                                     </SelectTrigger>
                                     <SelectContent>
                                         {chargeTypes.map(c => <SelectItem key={c.id} value={c.item}>{c.item}</SelectItem>)}
                                     </SelectContent>
                                 </Select>
                               ) : (
                                 <Input
                                    id="custom-charge-type"
                                    value={customChargeType}
                                    onChange={(e) => setCustomChargeType(e.target.value)}
                                    placeholder="Charge Type"
                                    className="flex-auto"
                                 />
                               )}
                                <Button type="button" size="sm" className="flex-none" onClick={handleApplyCharge}>Apply</Button>
                                <Button type="button" size="icon" variant="ghost" className="flex-none" onClick={() => setShowChargeForm(false)}>
                                    <X className="h-4 w-4"/>
                                    <span className="sr-only">Cancel</span>
                                </Button>
                            </div>
                        )}
                    </div>
                    <Separator className="my-2"/>
                     <div className="flex justify-between w-full max-w-sm self-end text-lg font-semibold">
                        <span>Total</span>
                        <span>{formatCurrency(grandTotal)}</span>
                    </div>
                </CardFooter>
            </Card>
          </div>

          <div className="space-y-6">
             <Card>
              <CardHeader>
                <CardTitle>Customer Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="space-y-2">
                  <Label htmlFor="customerName">Name</Label>
                  <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} onBlur={() => handleDetailsUpdate('customerName')} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="tin">TIN No. (Optional)</Label>
                  <Input 
                    id="tin" 
                    value={tin.inputValue}
                    onChange={handleTinChange}
                    onBlur={() => handleDetailsUpdate('tin')}
                    placeholder="xxx-xxx-xxx"
                    maxLength={11}
                  />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Textarea id="address" value={address} onChange={(e) => setAddress(e.target.value)} onBlur={() => handleDetailsUpdate('address')} />
                </div>
              </CardContent>
              <CardFooter>
                 <Button className="w-full" size="lg" onClick={() => setIsPaymentModalOpen(true)} disabled={billableItems.length === 0 || !online || hasPendingWrites}>Finalize Bill</Button>
              </CardFooter>
            </Card>
          </div>
       </div>
    </main>
    
    {isPaymentModalOpen && order && store && (
        <PaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          order={order}
          store={store}
          totalAmount={grandTotal}
          taxSummary={taxSummary}
          onFinalizeSuccess={handleFinalizeSuccess}
        />
    )}
    </>
  );
}
