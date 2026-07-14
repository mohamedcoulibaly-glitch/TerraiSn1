import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Map, Users, Banknote, LogOut } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Terrains from './pages/Terrains';
import Utilisateurs from './pages/Utilisateurs';
import Revenus from './pages/Revenus';

function Layout() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('admin_user') || 'null');
  if (!localStorage.getItem('admin_token') || user?.role !== 'super_admin') return <Navigate to="/login" replace />;
  const links = [['/', 'Dashboard', LayoutDashboard], ['/terrains', 'Terrains', Map], ['/utilisateurs', 'Utilisateurs', Users], ['/revenus', 'Revenus', Banknote]] as const;
  return <div className="shell"><aside><h1>TerrainSN Admin</h1><nav>{links.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'}><Icon size={18}/>{label}</NavLink>)}</nav><button className="logout" onClick={()=>{localStorage.clear();navigate('/login')}}><LogOut size={18}/>Déconnexion</button></aside><main><Routes><Route path="/" element={<Dashboard/>}/><Route path="/terrains" element={<Terrains/>}/><Route path="/utilisateurs" element={<Utilisateurs/>}/><Route path="/revenus" element={<Revenus/>}/></Routes></main></div>;
}
export default function App(){return <Routes><Route path="/login" element={<Login/>}/><Route path="/*" element={<Layout/>}/></Routes>}
