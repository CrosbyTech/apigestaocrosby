import React from 'react';
import { X, Clock, CheckCircle, XCircle } from '@phosphor-icons/react';

const PerformanceModal = ({ isOpen, onClose, performanceData }) => {
  if (!isOpen) return null;

  const formatTime = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusIcon = (success) => {
    return success ? (
      <CheckCircle className="w-4 h-4 text-green-500" />
    ) : (
      <XCircle className="w-4 h-4 text-red-500" />
    );
  };

  const getStatusColor = (success) => {
    return success ? 'text-green-600' : 'text-red-600';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-800">
              Performance das Rotas
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {performanceData?.routes?.map((route, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(route.success)}
                <div>
                  <div className="font-medium text-sm text-gray-800">
                    {route.name}
                  </div>
                  <div className="text-xs text-gray-500">{route.endpoint}</div>
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-semibold text-sm ${getStatusColor(
                    route.success,
                  )}`}
                >
                  {formatTime(route.duration)}
                </div>
                <div className="text-xs text-gray-500">
                  {route.recordCount} registros
                </div>
              </div>
            </div>
          ))}

          {performanceData?.total && (
            <div className="border-t border-gray-200 pt-3 mt-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-800">Total:</span>
                <span className="font-bold text-blue-600">
                  {formatTime(performanceData.total)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default PerformanceModal;
