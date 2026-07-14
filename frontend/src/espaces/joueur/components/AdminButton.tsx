import { Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const AdminButton = () => {
  const navigate = useNavigate();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="fixed top-3 right-3 z-50 bg-card/80 backdrop-blur-sm shadow-md rounded-full"
      onClick={() => navigate("/login")}
      title="Connexion"
    >
      <Shield className="w-5 h-5 text-primary" />
    </Button>
  );
};

export default AdminButton;
