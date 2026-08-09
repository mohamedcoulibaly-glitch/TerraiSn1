import { HeroResponsive } from '@/espaces/joueur/components/hero/HeroVariants';

/**
 * Bannière hero — hauteurs strictes Mobile / Tablette / Desktop.
 */
export const BannerVideoHeader = ({
  searchQuery = '',
  onSearchChange,
  onFilterClick,
  activeFilterCount = 0,
  onSearch,
  onFiltreClick,
  user: userProp,
}) => {
  const handleSearch = (value) => {
    onSearchChange?.(value);
    onSearch?.(value);
  };

  const handleFilter = () => {
    onFiltreClick?.();
    onFilterClick?.();
  };

  return (
    <HeroResponsive
      searchQuery={searchQuery}
      onSearchChange={handleSearch}
      onFilterClick={handleFilter}
      activeFilterCount={activeFilterCount}
      user={userProp}
    />
  );
};

export default BannerVideoHeader;
