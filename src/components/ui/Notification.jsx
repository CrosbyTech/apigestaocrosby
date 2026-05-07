import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Info, Warning, X } from '@phosphor-icons/react';

const Notification = ({
  type = 'success',
  message,
  duration = 4000,
  onClose,
  visible = true,
}) => {
  const [isVisible, setIsVisible] = useState(visible);

  useEffect(() => {
    setIsVisible(visible);
  }, [visible]);

  useEffect(() => {
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isVisible, duration]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose?.();
    }, 300); // Delay para animação de saída
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle size={20} className="text-green-600" />;
      case 'error':
        return <XCircle size={20} className="text-red-600" />;
      case 'warning':
        return <Warning size={20} className="text-yellow-600" />;
      case 'info':
        return <Info size={20} className="text-blue-600" />;
      default:
        return <CheckCircle size={20} className="text-green-600" />;
    }
  };

  const getStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'info':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      default:
        return 'bg-green-50 border-green-200 text-green-800';
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm w-full transform transition-all duration-300 ease-in-out ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className={`rounded-lg border shadow-lg p-4 ${getStyles()}`}>
        <div className="flex items-start">
          <div className="flex-shrink-0 mr-3">{getIcon()}</div>
          <div className="flex-1">
            <p className="text-sm font-medium whitespace-pre-line">{message}</p>
          </div>
          <div className="flex-shrink-0 ml-3">
            <button
              onClick={handleClose}
              className="inline-flex text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600 transition-colors duration-200"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Notification;
