
'use client';

import { useState, useEffect, useReducer, useMemo } from 'react';
import { useParams, notFound, useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import {
  doc,
  onSnapshot,
  collection,
  updateDoc,
  query,
  where,
  addDoc,
  serverTimestamp,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { Order, OrderItem, GListItem, OrderTransaction, Store } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency, parseCurrency } from '@/lib/utils';
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
  const [discountTypes, setDiscountTypes] = useState<GListItem[]>([]);
  
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [chargeValue, setChargeValue] = useState('');
  const [selectedCharge, setSelectedCharge] = useState('');
  const [customChargeType, setCustomChargeType] = useState('');
  const [chargeTypes, setChargeTypes] = useState<GListItem[]>([]);
  
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);


  const firestore = useFirestore();

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
        const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GListItem));
        setDiscountTypes(types);
      });
      
      const chargesQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'charge type'),
        where('is_active', '==', true),
        where('storeIds', 'array-contains', order.storeId)
      );
      const chargesUnsubscribe = onSnapshot(chargesQuery, (snapshot) => {
        const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GListItem));
        setChargeTypes(types);
      });

      return () => {
        storeUnsubscribe();
        discountsUnsubscribe();
        chargesUnsubscribe();
      }
    }
  }, [firestore, order?.storeId]);
  
  const subtotal = useMemo(() => orderItems.reduce((acc, item) => acc + (item.quantity * item.priceAtOrder), 0), [orderItems]);

  const grandTotal = useMemo(() => {
    return transactions.reduce((acc, trans) => {
      if (trans.type === 'Discount') {
        return acc - trans.amount;
      }
      if (trans.type === 'Charge') {
        return acc + trans.amount;
      }
      // 'Payment' types will be handled later
      return acc;
    }, subtotal);
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
        }
    } else if (field === 'customerName' && customerName !== order.customerName) {
        dataToUpdate.customerName = customerName;
    } else if (field === 'address' && address !== order.address) {
        dataToUpdate.address = address;
    }

    if (Object.keys(dataToUpdate).length > 0) {
        try {
            await updateDoc(orderRef, dataToUpdate);
        } catch (error) {
            console.error(`Error updating ${field}:`, error);
        }
    }
  };
  
  const handleApplyDiscount = async () => {
    if (!firestore || !order || !discountValue || !selectedDiscount) {
        alert('Please enter a value and select a discount type.');
        return;
    }

    const value = parseFloat(discountValue);
    let amount = 0;
    if (discountType === '₱') {
        amount = value;
    } else {
        amount = (subtotal * value) / 100;
    }

    if (amount <= 0) {
        alert('Discount amount must be positive.');
        return;
    }

    const newTransaction: Omit<OrderTransaction, 'id'> = {
        orderId: order.id,
        type: 'Discount',
        amount: amount,
        notes: selectedDiscount,
        timestamp: serverTimestamp(),
    };

    try {
        await addDoc(collection(firestore, 'orders', order.id, 'transactions'), newTransaction);
        // Reset form
        setDiscountValue('');
        setSelectedDiscount('');
        setShowDiscountForm(false);
    } catch (error) {
        console.error('Error applying discount:', error);
        alert('Failed to apply discount.');
    }
  };

  const handleApplyCharge = async () => {
    if (!firestore || !order || !chargeValue) {
        alert('Please enter a charge amount.');
        return;
    }
    const chargeName = chargeTypes.length > 0 ? selectedCharge : customChargeType;
    if (!chargeName) {
        alert('Please select or enter a charge type.');
        return;
    }
    const amount = parseFloat(chargeValue);
    if (amount <= 0) {
        alert('Charge amount must be positive.');
        return;
    }
    const newTransaction: Omit<OrderTransaction, 'id'> = {
        orderId: order.id,
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
    } catch (error) {
        console.error('Error applying charge:', error);
        alert('Failed to apply charge.');
    }
  };
  
  const handleFinalizeSuccess = () => {
    setIsPaymentModalOpen(false);
    router.push('/cashier');
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
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-center">Qty</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orderItems.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.menuName}</TableCell>
                                    <TableCell className="text-center">{item.quantity}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(item.priceAtOrder)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(item.quantity * item.priceAtOrder)}</TableCell>
                                </TableRow>
                            ))}
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
                                <Select value={selectedDiscount} onValueChange={setSelectedDiscount}>
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
                 <Button className="w-full" size="lg" onClick={() => setIsPaymentModalOpen(true)}>Finalize Bill</Button>
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
          onFinalizeSuccess={handleFinalizeSuccess}
        />
    )}
    </>
  );
}
