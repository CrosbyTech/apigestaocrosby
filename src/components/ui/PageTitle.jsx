import React from 'react';

const PageTitle = ({ 
  title, 
  subtitle, 
  icon: Icon, 
  color = "text-[#000638]", 
  iconColor = "text-[#000638]",
  className = "" 
}) => {
  return (
    <div className={`text-center mb-6 ${className}`}>
      <div className="flex justify-center gap-3 mb-2">
        {Icon && (
          <div className={`p-2 rounded-full bg-gradient-to-br from-blue-50 to-blue-100 shadow-sm`}>
            <Icon 
              size={24} 
              weight="light" 
              className={iconColor}
            />
          </div>
        )}
        <h1 className={`mt-1 text-2xl font-bold ${color} tracking-tight`}>
          {title}
        </h1>
      </div>
      {subtitle && (
        <p className="text-sm text-gray-600 max-w-2xl mx-auto leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
};

export default PageTitle;
