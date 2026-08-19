import type { ReactNode, TableHTMLAttributes } from "react";

export type SaTableProps = TableHTMLAttributes<HTMLTableElement> & {
  children: ReactNode;
  wrapperClassName?: string;
};

export function SaTable({ children, className, wrapperClassName, ...props }: SaTableProps) {
  return (
    <div className={`overflow-x-auto ${wrapperClassName || ""}`}>
      <table className={`sa-table ${className || ""}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export default SaTable;
