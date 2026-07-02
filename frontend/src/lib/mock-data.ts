import field1 from "@/assets/field-1.jpg";
import field2 from "@/assets/field-2.jpg";
import field3 from "@/assets/field-3.jpg";
import field4 from "@/assets/field-4.jpg";

export interface Terrain {
  id: string;
  nom: string;
  ville: string;
  adresse: string;
  type: string;
  prix_heure: number;
  photo: string;
  note: number;
  avis: number;
  disponible: boolean;
  proprietaire: string;
  description: string;
  telephone: string;
  horaires: string;
}

export interface Reservation {
  id: string;
  terrain: string;
  terrainPhoto: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  statut: "en_attente" | "acceptee" | "refusee" | "annulee";
  montant: number;
  joueur: string;
}

export interface Employe {
  id: string;
  nom: string;
  telephone: string;
  terrain: string;
  statut: "actif" | "inactif";
}

export const terrains: Terrain[] = [
  { id: "1", nom: "Complexe Sportif Pikine", ville: "Dakar", adresse: "Rue 10, Pikine", type: "11 vs 11", prix_heure: 5000, photo: field1, note: 4.9, avis: 128, disponible: true, proprietaire: "M. Diop", description: "Terrain en gazon synthétique de dernière génération avec éclairage LED.", telephone: "+221 77 123 45 67", horaires: "08h - 22h" },
  { id: "2", nom: "Terrain Almadies", ville: "Dakar", adresse: "Les Almadies", type: "7 vs 7", prix_heure: 7500, photo: field2, note: 4.7, avis: 85, disponible: true, proprietaire: "M. Diop", description: "Petit terrain en gazon synthétique idéal pour les matchs 7v7.", telephone: "+221 77 234 56 78", horaires: "09h - 23h" },
  { id: "3", nom: "Stade Municipal Saly", ville: "Thiès", adresse: "Saly Portudal", type: "11 vs 11", prix_heure: 6000, photo: field3, note: 4.5, avis: 42, disponible: true, proprietaire: "Mme Fall", description: "Grand terrain avec vestiaires et parking gratuit.", telephone: "+221 77 345 67 89", horaires: "07h - 21h" },
  { id: "4", nom: "Foot Indoor Ouakam", ville: "Dakar", adresse: "Ouakam", type: "5 vs 5", prix_heure: 4000, photo: field4, note: 4.8, avis: 210, disponible: false, proprietaire: "M. Diop", description: "Terrain indoor couvert, jouable même sous la pluie.", telephone: "+221 77 456 78 90", horaires: "08h - 00h" },
  { id: "5", nom: "Stade Demba Diop", ville: "Dakar", adresse: "Plateau", type: "11 vs 11", prix_heure: 8000, photo: field1, note: 4.6, avis: 95, disponible: true, proprietaire: "Mme Fall", description: "Terrain homologué avec tribunes et vestiaires modernes.", telephone: "+221 77 567 89 01", horaires: "08h - 22h" },
  { id: "6", nom: "Terrain Guédiawaye", ville: "Dakar", adresse: "Guédiawaye", type: "7 vs 7", prix_heure: 3500, photo: field4, note: 4.3, avis: 67, disponible: true, proprietaire: "M. Ndiaye", description: "Terrain de quartier bien entretenu, ambiance conviviale.", telephone: "+221 77 678 90 12", horaires: "09h - 22h" },
  { id: "7", nom: "Complexe Sportif Thiaroye", ville: "Dakar", adresse: "Thiaroye", type: "11 vs 11", prix_heure: 4500, photo: field3, note: 4.4, avis: 53, disponible: true, proprietaire: "M. Diop", description: "Deux terrains côte à côte avec buvette sur place.", telephone: "+221 77 789 01 23", horaires: "08h - 22h" },
  { id: "8", nom: "Terrain Saint-Louis Centre", ville: "Saint-Louis", adresse: "Centre-ville", type: "7 vs 7", prix_heure: 3000, photo: field2, note: 4.2, avis: 31, disponible: true, proprietaire: "M. Ndiaye", description: "Terrain en plein cœur de Saint-Louis avec vue sur le fleuve.", telephone: "+221 77 890 12 34", horaires: "08h - 21h" },
];

export const reservations: Reservation[] = [
  { id: "1", terrain: "Complexe Sportif Pikine", terrainPhoto: field1, date: "12 Avr 2026", heure_debut: "16:00", heure_fin: "18:00", statut: "acceptee", montant: 10000, joueur: "Abdou Sow" },
  { id: "2", terrain: "Terrain Almadies", terrainPhoto: field2, date: "13 Avr 2026", heure_debut: "10:00", heure_fin: "12:00", statut: "en_attente", montant: 15000, joueur: "Fatou Diallo" },
  { id: "3", terrain: "Stade Municipal Saly", terrainPhoto: field3, date: "11 Avr 2026", heure_debut: "08:00", heure_fin: "10:00", statut: "refusee", montant: 12000, joueur: "Moussa Ba" },
  { id: "4", terrain: "Foot Indoor Ouakam", terrainPhoto: field4, date: "10 Avr 2026", heure_debut: "19:00", heure_fin: "21:00", statut: "acceptee", montant: 8000, joueur: "Awa Ndiaye" },
  { id: "5", terrain: "Complexe Sportif Pikine", terrainPhoto: field1, date: "14 Avr 2026", heure_debut: "14:00", heure_fin: "16:00", statut: "en_attente", montant: 10000, joueur: "Ibrahima Fall" },
  { id: "6", terrain: "Terrain Guédiawaye", terrainPhoto: field4, date: "15 Avr 2026", heure_debut: "17:00", heure_fin: "19:00", statut: "annulee", montant: 7000, joueur: "Cheikh Mbaye" },
];

export const employes: Employe[] = [
  { id: "1", nom: "Mamadou Sarr", telephone: "+221 77 111 22 33", terrain: "Complexe Sportif Pikine", statut: "actif" },
  { id: "2", nom: "Ousmane Diagne", telephone: "+221 77 222 33 44", terrain: "Terrain Almadies", statut: "actif" },
  { id: "3", nom: "Amadou Niang", telephone: "+221 77 333 44 55", terrain: "Foot Indoor Ouakam", statut: "inactif" },
];

export const ownerStats = {
  totalRevenue: 1240000,
  occupancyRate: 84,
  totalReservations: 156,
  pendingReservations: 4,
  totalTerrains: 4,
  totalEmployes: 3,
  weeklyRevenue: [180000, 220000, 195000, 210000, 240000, 175000, 200000],
  monthlyRevenue: [850000, 920000, 1100000, 1240000],
  terrainStats: [
    { nom: "Complexe Sportif Pikine", reservations: 42, revenue: 420000, occupancy: 88 },
    { nom: "Terrain Almadies", reservations: 28, revenue: 210000, occupancy: 72 },
    { nom: "Foot Indoor Ouakam", reservations: 35, revenue: 140000, occupancy: 91 },
    { nom: "Complexe Sportif Thiaroye", reservations: 22, revenue: 99000, occupancy: 65 },
  ],
};
