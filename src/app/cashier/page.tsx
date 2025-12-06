export default function CashierPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Left Panel */}
      <div className="w-1/3 border-r border-border p-4">
        <h2 className="text-lg font-semibold">Order Summary</h2>
      </div>

      {/* Right Panel */}
      <div className="w-2/3 p-4">
        <h2 className="text-lg font-semibold">Menu Items</h2>
      </div>
    </div>
  );
}
