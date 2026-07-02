import { ArrowLeft, TrendingUp, DollarSign, Calendar, Download, BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { proprietaireApi } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COLORS = ["hsl(145,63%,30%)", "hsl(42,80%,55%)", "hsl(210,70%,50%)", "hsl(0,72%,51%)"];
const periodOptions = [
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois" },
  { value: "year", label: "Cette année" },
];

const OwnerReports = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [period, setPeriod] = useState("week");

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await proprietaireApi.stats();
      setStats(data);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    // Generate CSV data
    const headers = ["Terrain", "Réservations", "Revenus (CFA)", "Taux d'occupation"];
    const rows = stats?.terrainStats?.map((t: any) => [
      t.nom,
      t.reservations,
      t.revenue,
      `${t.occupancy}%`,
    ]) || [];
    
    const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport_${period}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export CSV téléchargé");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  const totalRevenue = stats?.totalRevenue || 0;
  const totalReservations = stats?.totalReservations || 0;
  const occupancyRate = stats?.occupancyRate || 0;
  const weeklyData = stats?.weeklyRevenue || [];
  const pieData = stats?.terrainStats?.map((t: any) => ({ name: t.nom, value: t.revenue })) || [];

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-primary responsive-padding pt-5 pb-8 rounded-b-3xl">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => navigate("/proprietaire")} className="bg-primary-foreground/20 rounded-full p-2">
              <ArrowLeft className="w-5 h-5 text-primary-foreground" />
            </button>
            <span className="font-display font-bold text-primary-foreground text-sm">⚽ TerrainSN</span>
          </div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-primary-foreground">Rapports détaillés</h1>
          <p className="text-primary-foreground/70 text-sm mt-1">Analysez les performances de vos terrains</p>
        </div>

        {/* Period Selector & Export */}
        <div className="responsive-padding mt-4 flex items-center justify-between gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Période" />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!stats?.terrainStats?.length}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="responsive-padding grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Revenus totaux</span>
            </div>
            <p className="font-display font-bold text-lg sm:text-xl">{totalRevenue.toLocaleString()} CFA</p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-accent flex items-center justify-center">
                <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-accent-foreground" />
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Réservations</span>
            </div>
            <p className="font-display font-bold text-lg sm:text-xl">{totalReservations}</p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-secondary/20 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-secondary" />
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Taux d'occup.</span>
            </div>
            <p className="font-display font-bold text-lg sm:text-xl">{occupancyRate}%</p>
          </div>
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-muted flex items-center justify-center">
                <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Terrains</span>
            </div>
            <p className="font-display font-bold text-lg sm:text-xl">{stats?.terrainStats?.length || 0}</p>
          </div>
        </div>

        {/* Charts */}
        <div className="responsive-padding mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Revenue Chart */}
          <div>
            <h2 className="section-title flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4" />
              Revenus par jour (7 jours)
            </h2>
            <div className="stat-card">
              {weeklyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={weeklyData}>
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip 
                      formatter={(value: number) => [`${value.toLocaleString()} CFA`, "Revenu"]} 
                      contentStyle={{ borderRadius: 12, fontSize: 12 }} 
                    />
                    <Bar dataKey="revenue" fill="hsl(145,63%,30%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                  Aucune donnée disponible
                </div>
              )}
            </div>
          </div>

          {/* Revenue by Terrain */}
          <div>
            <h2 className="section-title mb-3">🏟️ Répartition par terrain</h2>
            <div className="stat-card flex flex-col sm:flex-row items-center gap-4">
              {pieData.length > 0 ? (
                <>
                  <ResponsiveContainer width={150} height={150}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                        {pieData.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 flex flex-col gap-2 w-full">
                    {pieData.map((d: any, i: number) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-xs sm:text-sm truncate flex-1">{d.name}</span>
                        <span className="text-xs sm:text-sm font-bold">{d.value.toLocaleString()} CFA</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-8">
                  Aucune donnée disponible
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="responsive-padding mt-6">
          <h2 className="section-title mb-4">Détails par terrain</h2>
          <div className="glass-card overflow-hidden">
            {stats?.terrainStats?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-xs font-medium text-muted-foreground p-3 text-left">Terrain</th>
                      <th className="text-xs font-medium text-muted-foreground p-3 text-right">Réservations</th>
                      <th className="text-xs font-medium text-muted-foreground p-3 text-right">Revenus</th>
                      <th className="text-xs font-medium text-muted-foreground p-3 text-right">Occupation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.terrainStats.map((t: any) => (
                      <tr key={t.nom} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <span className="text-sm font-medium">{t.nom}</span>
                        </td>
                        <td className="p-3 text-right">
                          <span className="text-sm">{t.reservations}</span>
                        </td>
                        <td className="p-3 text-right">
                          <span className="text-sm font-bold text-primary">{t.revenue.toLocaleString()} CFA</span>
                        </td>
                        <td className="p-3 text-right">
                          <span className="text-sm">{t.occupancy}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Aucune donnée disponible
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OwnerReports;