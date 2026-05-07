import React from 'react';

const LoadingSpinner = ({ size = 'md', text = 'Carregando...' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className={`${sizeClasses[size]} animate-spin rounded-full border-4 border-gray-200 border-t-blue-600`}></div>
      {text && <p className="mt-2 text-gray-600 text-sm">{text}</p>}
    </div>
  );
};

export default LoadingSpinner; 