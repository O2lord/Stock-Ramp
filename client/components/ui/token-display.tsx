import React, { useState } from 'react';
import Image from 'next/image';

interface TokenDisplayProps {
  logoURI?: string;
  amount: number | string | null;
  symbol?: string;
  showSymbol?: boolean;
  showAmount?: boolean; 
  className?: string;
  imageSize?: number;
}

const TokenDisplay: React.FC<TokenDisplayProps> = ({
  logoURI,
  amount,
  symbol = 'Tokens',
  showSymbol = true,
  className = '',
  imageSize = 20
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Handle null case
  if (amount === null) {
    return <span className={className}>Loading...</span>;
  }

  const handleImageError = () => {
    setImageError(true);
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  return (
    <span className={`flex items-center gap-2 font-medium ${className}`}>
      
      
      {logoURI && !imageError ? (
        // Show only the logo when available
        <Image
          src={logoURI}
          alt={`${symbol} logo`}
          width={imageSize}
          height={imageSize}
          className="rounded-full"
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      ) : (
        // Fallback to symbol text when no logoURI or image failed to load
        showSymbol && <span>{symbol}</span>
      )}
      <span>{amount}</span>
    </span>
  );
};

export default TokenDisplay;