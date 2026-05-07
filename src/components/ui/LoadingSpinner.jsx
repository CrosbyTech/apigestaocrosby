import React from 'react';

const LoadingSpinner = ({
  size = 'md',
  color = 'blue',
  text = '',
  overlay = false,
  className = '',
}) => {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'w-4 h-4';
      case 'md':
        return 'w-6 h-6';
      case 'lg':
        return 'w-8 h-8';
      case 'xl':
        return 'w-12 h-12';
      default:
        return 'w-6 h-6';
    }
  };

  const getColorClasses = () => {
    switch (color) {
      case 'blue':
        return 'border-blue-600';
      case 'green':
        return 'border-green-600';
      case 'red':
        return 'border-red-600';
      case 'yellow':
        return 'border-yellow-600';
      case 'gray':
        return 'border-gray-600';
      default:
        return 'border-blue-600';
    }
  };

  const spinner = (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className={`${getSizeClasses()} ${getColorClasses()} border-2 border-t-transparent rounded-full animate-spin`}
      ></div>
      {text && <p className="mt-2 text-sm text-gray-600 font-medium">{text}</p>}
    </div>
  );

  if (overlay) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6">{spinner}</div>
      </div>
    );
  }

  return spinner;
};

export default LoadingSpinner;
