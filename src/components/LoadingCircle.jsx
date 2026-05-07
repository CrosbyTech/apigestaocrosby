import React from 'react';

const LoadingCircle = ({ size = 'large', text = 'Carregando...' }) => {
  const sizeClasses = {
    small: 'h-8 w-8',
    medium: 'h-16 w-16', 
    large: 'h-32 w-32'
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className={`animate-spin rounded-full ${sizeClasses[size]} border-b-2 border-gray-900 mx-auto mb-4`}></div>
        <p className="text-gray-600">{text}</p>
      </div>
    </div>
  );
};

export default LoadingCircle; 