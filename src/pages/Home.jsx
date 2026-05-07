import React, { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import LoginNoticesModal from '../components/LoginNoticesModal';

const Home = () => {
  const { user } = useAuth();
  const [showNoticesModal, setShowNoticesModal] = useState(true);

  return (
    <>
      {/* Modal de avisos ao fazer login */}
      {showNoticesModal && (
        <LoginNoticesModal onClose={() => setShowNoticesModal(false)} />
      )}

      <div className="justify-center w-4/5 bg-white rounded-2xl shadow-2xl p-8 flex flex-col md:flex-row items-center gap-8 mt-8 mx-auto">
        <div className="flex-1 flex flex-col items-center md:items-start">
          <h1 className="text-3xl md:text-5xl font-bold mb-4 text-[#000638] text-center md:text-left font-barlow">
            Bem-vindo {user?.name.split(' ')[0]}!
          </h1>
          <p className="text-lg md:text-2xl text-gray-700 mb-6 text-center md:text-left font-barlow">
            Você está logado no sistema HEADCOACH CROSBY.
          </p>
        </div>
        <div className="flex-1 flex justify-center">
          <img src="/crosbyazul.png" alt="Logo" className="w-40 md:w-72" />
        </div>
      </div>
    </>
  );
};

export default Home;
