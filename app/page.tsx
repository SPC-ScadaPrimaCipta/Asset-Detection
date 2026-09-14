export default function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Automatic Asset Detection</h1>
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 border rounded-lg bg-white">Total Projects: 0</div>
        <div className="p-4 border rounded-lg bg-white">Active Jobs: 0</div>
      </div>
    </div>
  );
}
