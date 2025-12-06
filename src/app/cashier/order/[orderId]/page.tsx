
'use client';

import { useState, useEffect, useReducer } from 'react';
import { useParams, notFound, useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot, collection, updateDoc, query, where } from 'firebase/firestore';
import { Order, OrderItem, GListItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus } from 'lucide-react';
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


// Reducer for complex state management of TIN input
const tinReducer = (state: any, action: any) => {
  switch (action.type) {
    case 'SET_FORMATTED':
      return { ...state, formatted: action.payload };
    case 'SET_UNMASKED':
       return { ...state, unmasked: action.payload };
    case 'SET_ALL':
        return { formatted: action.payload.formatted, unmasked: action.payload.unmasked };
    default:
      return state;
  }
};

const formatTIN = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  let formatted = '';
  if (digits.length > 0) {
    formatted = digits.slice(0, 3);
  }
  if (digits.length > 3) {
    formatted += `-${digits.slice(3, 6)}`;
  }
  if (digits.length > 6) {
    formatted += `-${digits.slice(6, 9)}`;
  }
  return formatted ? `${formatted}-000` : '';
};


export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');

  const [tin, dispatch] = useReducer(tinReducer, {
    formatted: '',
    unmasked: '',
  });

  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState<'₱' | '%'>('₱');
  const [selectedDiscount, setSelectedDiscount] = useState('');
  const [discountTypes, setDiscountTypes] = useState<GListItem[]>([]);


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
        const unmaskedTin = (orderData.tin || '').replace(/\D/g, '').slice(0, 9);
        dispatch({ type: 'SET_ALL', payload: { unmasked: unmaskedTin, formatted: formatTIN(unmaskedTin) } });

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
    
    return () => {
      orderUnsubscribe();
      itemsUnsubscribe();
    };
  }, [firestore, orderId]);
  
  useEffect(() => {
    if (firestore && order?.storeId) {
      const discountsQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'discount type'),
        where('is_active', '==', true),
        where('storeIds', 'array-contains', order.storeId)
      );

      const unsubscribe = onSnapshot(discountsQuery, (snapshot) => {
        const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GListItem));
        setDiscountTypes(types);
      });

      return () => unsubscribe();
    }
  }, [firestore, order?.storeId]);

  const handleTinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 9);
    dispatch({ type: 'SET_UNMASKED', payload: value });
    dispatch({ type: 'SET_FORMATTED', payload: formatTIN(value) });
  };
  
  const handleUpdateDetails = async () => {
    if (!firestore || !order) return;
    const orderRef = doc(firestore, 'orders', order.id);
    try {
      await updateDoc(orderRef, {
        customerName: customerName,
        address: address,
        tin: tin.unmasked ? tin.formatted : ''
      });
      // Add a toast notification for success
    } catch (error) {
      console.error("Error updating customer details: ", error);
      // Add a toast notification for error
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
    <main className="flex-1 p-4 lg:p-6">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back</span>
        </Button>
        <div>
            <h1 className="text-2xl font-semibold font-headline">Order #{order.id.substring(0, 6)}</h1>
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
                <CardFooter className="flex flex-col items-end gap-2">
                    <div className="flex justify-between w-full max-w-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-medium">{formatCurrency(order.totalAmount)}</span>
                    </div>
                     <div className="flex flex-col items-stretch gap-2 w-full max-w-sm self-end">
                      {!showDiscountForm && (
                        <div className="flex justify-end gap-2 w-full">
                            <Button variant="outline" onClick={() => setShowDiscountForm(true)}>
                                <Plus className="mr-2 h-4 w-4" /> Add Discount
                            </Button>
                            <Button variant="outline">
                                <Plus className="mr-2 h-4 w-4" /> Add Charge
                            </Button>
                        </div>
                      )}
                      {showDiscountForm && (
                        <div className="grid grid-cols-1 gap-2 rounded-lg border p-4">
                            <div className="grid grid-cols-3 gap-2">
                               <div className="space-y-1 col-span-2">
                                   <Label htmlFor="discount-value" className="text-xs">Value</Label>
                                   <div className="flex">
                                        <Input 
                                            id="discount-value"
                                            type="number"
                                            value={discountValue}
                                            onChange={(e) => setDiscountValue(e.target.value)}
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
                               </div>
                               <div className="space-y-1">
                                   <Label htmlFor="discount-type" className="text-xs">Type</Label>
                                    <Select value={selectedDiscount} onValueChange={setSelectedDiscount}>
                                        <SelectTrigger id="discount-type">
                                            <SelectValue placeholder="Select..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {discountTypes.map(d => <SelectItem key={d.id} value={d.item}>{d.item}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                               </div>
                            </div>
                             <div className="flex justify-end gap-2 mt-2">
                                <Button type="button" size="sm" variant="ghost" onClick={() => setShowDiscountForm(false)}>Cancel</Button>
                                <Button type="button" size="sm">Apply</Button>
                            </div>
                        </div>
                      )}
                    </div>
                    <Separator className="my-2 w-full max-w-sm"/>
                     <div className="flex justify-between w-full max-w-sm text-lg font-semibold">
                        <span>Total</span>
                        <span>{formatCurrency(order.totalAmount)}</span>
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
                  <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} onBlur={handleUpdateDetails} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="tin">TIN No. (Optional)</Label>
                  <Input 
                    id="tin" 
                    value={tin.formatted}
                    onChange={handleTinChange}
                    onBlur={handleUpdateDetails}
                    placeholder="xxx-xxx-xxx-000"
                  />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Textarea id="address" value={address} onChange={(e) => setAddress(e.target.value)} onBlur={handleUpdateDetails} />
                </div>
              </CardContent>
              <CardFooter>
                 <Button className="w-full" size="lg">Finalize Bill</Button>
              </CardFooter>
            </Card>
          </div>
       </div>

    </main>
  );
}
