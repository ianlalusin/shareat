export default function CashierPage() {
  return (
    <div className="flex h-screen bg-background">
      {/* Left Panel */}
      <div className="w-1/3 border-r border-border">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Left Panel</h2>
        </div>
      </div>

      {/* Right Panel */}
      <div className="w-2/3">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Right Panel</h2>
        </div>
      </div>
    </div>
  );
}
