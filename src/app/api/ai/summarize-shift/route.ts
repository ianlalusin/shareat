
import { NextRequest, NextResponse } from 'next/server';
import { summarizeShiftFlow, ShiftStats } from '@/ai/flows/shift-summary-flow';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from '@/firebase/server-init';

export async function POST(req: NextRequest) {
  try {
    const { storeId, startTimestamp, endTimestamp } = await req.json();

    if (!storeId || !startTimestamp || !endTimestamp) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    initFirebaseAdmin();
    const firestore = getFirestore();

    const startDate = new Date(startTimestamp);
    const endDate = new Date(endTimestamp);

    const ordersQuery = firestore.collection('orders')
        .where('storeId', '==', storeId)
        .where('status', '==', 'Completed')
        .where('completedTimestamp', '>=', startDate)
        .where('completedTimestamp', '<=', endDate);
        
    const ordersSnapshot = await ordersQuery.get();

    const ordersData = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (ordersData.length === 0) {
        return NextResponse.json({
            rawStats: { ordersCount: 0 },
            aiSummary: "No completed orders were found for the selected period. There is no data to analyze."
        });
    }

    // --- Aggregation ---
    const ordersCount = ordersData.length;
    const totalGuests = ordersData.reduce((sum, order) => sum + (order.guestCount || 0), 0);

    const packageCounts: Record<string, number> = {};
    ordersData.forEach(order => {
        if (order.packageName) {
            packageCounts[order.packageName] = (packageCounts[order.packageName] || 0) + 1;
        }
    });
    const topPackages = Object.entries(packageCounts).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);

    const orderIds = ordersData.map(o => o.id);
    const refillsQuery = firestore.collectionGroup('refills').where('orderId', 'in', orderIds);
    const transactionsQuery = firestore.collectionGroup('transactions').where('orderId', 'in', orderIds);
    const orderItemsQuery = firestore.collectionGroup('orderItems').where('orderId', 'in', orderIds);
    
    const [refillsSnapshot, transactionsSnapshot, orderItemsSnapshot] = await Promise.all([
        refillsQuery.get(),
        transactionsQuery.get(),
        orderItemsQuery.get()
    ]);
    
    const refillsData = refillsSnapshot.docs.map(doc => doc.data());
    const transactionsData = transactionsSnapshot.docs.map(doc => doc.data());
    const orderItemsData = orderItemsSnapshot.docs.map(doc => doc.data());

    const meatRefillCounts: Record<string, { total: number; flavors: Record<string, number> }> = {};
    refillsData.forEach(refill => {
        const meatType = refill.menuName.split(' - ')[0]; // Assumes "Meat - Flavor" format
        const flavor = refill.menuName.split(' - ')[1] || 'Original';
        if (!meatRefillCounts[meatType]) {
            meatRefillCounts[meatType] = { total: 0, flavors: {} };
        }
        meatRefillCounts[meatType].total += refill.quantity;
        meatRefillCounts[meatType].flavors[flavor] = (meatRefillCounts[meatType].flavors[flavor] || 0) + refill.quantity;
    });

    const refillStats = Object.entries(meatRefillCounts).map(([meat, data]) => ({
        meatType: meat,
        totalRefills: data.total,
        topFlavors: Object.entries(data.flavors).sort((a, b) => b[1] - a[1]).slice(0, 2).map(f => f[0]),
    })).sort((a,b) => b.totalRefills - a.totalRefills);

    const totalLineDiscounts = orderItemsData.reduce((sum, item) => sum + (item.lineDiscountAmount || 0), 0);
    const totalTransactionDiscounts = transactionsData.filter(t => t.type === 'Discount').reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalDiscounts = totalLineDiscounts + totalTransactionDiscounts;

    const totalCharges = transactionsData.filter(t => t.type === 'Charge').reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const rawStats: ShiftStats = {
        storeId,
        ordersCount,
        totalGuests,
        topPackages,
        refillStats,
        totalDiscounts,
        totalCharges
    };

    // --- AI Summary ---
    const aiResult = await summarizeShiftFlow(rawStats);

    return NextResponse.json({
      rawStats,
      aiSummary: aiResult.summary,
    });

  } catch (error) {
    console.error('Error in shift summary API:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
