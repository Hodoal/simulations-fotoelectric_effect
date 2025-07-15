import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download } from 'lucide-react';

const PhotoelectricSimulator = () => {
  // Estados principales
  const [frequency, setFrequency] = useState(6.0); // x10^14 Hz
  const [intensity, setIntensity] = useState(50); // %
  const [selectedMetal, setSelectedMetal] = useState('Na');
  const [isRunning, setIsRunning] = useState(false);
  const [electrons, setElectrons] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [showGraph, setShowGraph] = useState(false);
  
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  // Propiedades de los metales (función trabajo en eV)
  const metals = {
    'Cs': { name: 'Cesio', workFunction: 2.1, color: '#FFD700' },
    'K': { name: 'Potasio', workFunction: 2.3, color: '#DDA0DD' },
    'Na': { name: 'Sodio', workFunction: 2.75, color: '#FFA500' },
    'Ca': { name: 'Calcio', workFunction: 2.87, color: '#32CD32' },
    'Zn': { name: 'Zinc', workFunction: 4.33, color: '#708090' },
    'Cu': { name: 'Cobre', workFunction: 4.65, color: '#B87333' },
    'Al': { name: 'Aluminio', workFunction: 4.28, color: '#C0C0C0' }
  };

  // Constantes físicas
  const h = 4.136e-15; // Constante de Planck (eV·s)
  const c = 3e8; // Velocidad de la luz (m/s)
  const e = 1.602e-19; // Carga del electrón (C)

  // Cálculos físicos
  const photonEnergy = h * frequency * 1e14; // eV
  const workFunction = metals[selectedMetal].workFunction;
  const maxKineticEnergy = Math.max(0, photonEnergy - workFunction);
  const stoppingVoltage = maxKineticEnergy; // V
  const canEmitElectrons = photonEnergy > workFunction;

  // Convertir frecuencia a longitud de onda y color
  const wavelength = (c / (frequency * 1e14)) * 1e9; // nm
  const getWavelengthColor = (wl) => {
    if (wl < 380) return '#8B00FF'; // UV
    if (wl < 450) return '#4B0082'; // Violeta
    if (wl < 495) return '#0000FF'; // Azul
    if (wl < 570) return '#00FF00'; // Verde
    if (wl < 590) return '#FFFF00'; // Amarillo
    if (wl < 620) return '#FF7F00'; // Naranja
    if (wl < 750) return '#FF0000'; // Rojo
    return '#FF4500'; // IR
  };

  const lightColor = getWavelengthColor(wavelength);

  // Animación de electrones
  useEffect(() => {
    if (!isRunning || !canEmitElectrons) {
      setElectrons([]);
      return;
    }

    const animate = () => {
      setElectrons(prev => {
        let newElectrons = [...prev];
        
        // Agregar nuevos electrones basado en la intensidad
        if (Math.random() < intensity / 1000) {
          const speed = Math.sqrt(maxKineticEnergy) * 20; // Proporcional a √(Ec)
          newElectrons.push({
            id: Date.now() + Math.random(),
            x: 300,
            y: 200 + (Math.random() - 0.5) * 60,
            vx: speed * (0.8 + Math.random() * 0.4),
            vy: (Math.random() - 0.5) * speed * 0.3,
            life: 100
          });
        }
        
        // Actualizar posición y eliminar electrones antiguos
        newElectrons = newElectrons
          .map(e => ({
            ...e,
            x: e.x + e.vx,
            y: e.y + e.vy,
            life: e.life - 1
          }))
          .filter(e => e.life > 0 && e.x < 800);
        
        return newElectrons;
      });
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRunning, canEmitElectrons, intensity, maxKineticEnergy]);

  // Registrar medición
  const recordMeasurement = () => {
    // Agregar ruido aleatorio (±2% de variación)
    const addNoise = (value) => {
      const noise = value * (1 + (Math.random() - 0.5) * 0.04);
      return Math.max(0, noise); // Asegurar que no sea negativo
    };

    const kineticEnergy = addNoise(maxKineticEnergy);
    const photonEnergyWithNoise = addNoise(photonEnergy);

    const newMeasurement = {
      frequency: frequency,
      wavelength: wavelength.toFixed(1),
      photonEnergy: photonEnergyWithNoise.toFixed(3),
      kineticEnergy: kineticEnergy.toFixed(3),
      stoppingVoltage: kineticEnergy.toFixed(3), // El voltaje de frenado es igual a la energía cinética
      metal: selectedMetal,
      emitsElectrons: canEmitElectrons
    };
    setMeasurements(prev => [...prev, newMeasurement]);
  };

  // Limpiar mediciones
  const clearMeasurements = () => {
    setMeasurements([]);
  };

  // Exportar datos
  const exportData = () => {
    const csvContent = "data:text/csv;charset=utf-8," + 
      "Frecuencia(Hz),Longitud(nm),Energía Fotón(eV),Energía Cinética(eV),Voltaje Frenado(V),Metal,Emite Electrones\n" +
      measurements.map(m => 
        `${m.frequency}e14,${m.wavelength},${m.photonEnergy},${m.kineticEnergy},${m.stoppingVoltage},${m.metal},${m.emitsElectrons}`
      ).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "efecto_fotoelectrico_datos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
        Simulador del Efecto Fotoeléctrico
      </h1>
      
      {/* Contenedor principal con nuevo layout */}
      <div className="flex flex-col gap-6">
        {/* Fila superior con controles y simulación */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Panel de Control */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Panel de Control</h2>
            
            {/* Frecuencia */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Frecuencia: {frequency.toFixed(1)} × 10¹⁴ Hz
              </label>
              <input
                type="range"
                min="3"
                max="12"
                step="0.1"
                value={frequency}
                onChange={(e) => setFrequency(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>IR</span>
                <span>Visible</span>
                <span>UV</span>
              </div>
            </div>

            {/* Intensidad */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Intensidad: {intensity}%
              </label>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={intensity}
                onChange={(e) => setIntensity(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Metal */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                Material del Cátodo
              </label>
              <select
                value={selectedMetal}
                onChange={(e) => setSelectedMetal(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(metals).map(([symbol, metal]) => (
                  <option key={symbol} value={symbol}>
                    {metal.name} ({symbol}) - {metal.workFunction} eV
                  </option>
                ))}
              </select>
            </div>

            {/* Controles */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setIsRunning(!isRunning)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-white font-medium ${
                  isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {isRunning ? <Pause size={16} /> : <Play size={16} />}
                {isRunning ? 'Pausar' : 'Iniciar'}
              </button>
              <button
                onClick={() => setIsRunning(false)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md"
              >
                <RotateCcw size={16} />
                Reset
              </button>
            </div>

            {/* Información de la luz */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Propiedades de la Luz</h3>
              <div className="space-y-1 text-sm">
                <div>Longitud de onda: {wavelength.toFixed(1)} nm</div>
                <div>Energía del fotón: {photonEnergy.toFixed(3)} eV</div>
                <div className="flex items-center gap-2">
                  Color: 
                  <div 
                    className="w-6 h-4 rounded border"
                    style={{ backgroundColor: lightColor }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Simulación Visual */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Simulación</h2>
            
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ height: '400px' }}>
              {/* Fuente de luz */}
              <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                <div className="w-8 h-12 bg-yellow-400 rounded-r-lg flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                </div>
              </div>

              {/* Haz de luz */}
              {isRunning && (
                <div 
                  className="absolute left-12 top-1/2 transform -translate-y-1/2 h-2 opacity-60"
                  style={{ 
                    width: '220px',
                    backgroundColor: lightColor,
                    boxShadow: `0 0 20px ${lightColor}`
                  }}
                />
              )}

              {/* Superficie metálica */}
              <div 
                className="absolute w-4 h-32 top-1/2 transform -translate-y-1/2 rounded-l-lg"
                style={{ 
                  left: '240px',
                  backgroundColor: metals[selectedMetal].color,
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.3)'
                }}
              />

              {/* Etiqueta del metal */}
              <div className="absolute text-white text-xs" style={{ left: '260px', top: '40px' }}>
                {metals[selectedMetal].name}
                <br />
                φ = {workFunction} eV
              </div>

              {/* Electrones emitidos */}
              {electrons.map(electron => (
                <div
                  key={electron.id}
                  className="absolute w-2 h-2 bg-blue-400 rounded-full"
                  style={{
                    left: `${electron.x}px`,
                    top: `${electron.y}px`,
                    opacity: electron.life / 100,
                    boxShadow: '0 0 4px #3B82F6'
                  }}
                />
              ))}

              {/* Colector/Ánodo */}
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 w-4 h-32 bg-gray-600 rounded-r-lg" />

              {/* Voltímetro */}
              <div className="absolute bottom-4 left-4 bg-gray-800 text-white px-3 py-2 rounded text-sm">
                <div>V = {stoppingVoltage.toFixed(3)} V</div>
                <div>Ec = {maxKineticEnergy.toFixed(3)} eV</div>
              </div>

              {/* Indicador de emisión */}
              <div className="absolute top-4 right-4">
                <div className={`w-4 h-4 rounded-full ${canEmitElectrons ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="text-white text-xs mt-1">
                  {canEmitElectrons ? 'Emitiendo' : 'Sin emisión'}
                </div>
              </div>
            </div>

            {/* Botón para registrar medición */}
            <button
              onClick={recordMeasurement}
              className="w-full mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-medium"
            >
              Registrar Medición
            </button>
          </div>
        </div>

        {/* Panel de Mediciones (ahora ocupa todo el ancho) */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-700">Mediciones</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowGraph(!showGraph)}
                className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm"
              >
                {showGraph ? 'Tabla' : 'Gráfica'}
              </button>
              <button
                onClick={exportData}
                className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-sm"
                disabled={measurements.length === 0}
              >
                <Download size={14} />
              </button>
              <button
                onClick={clearMeasurements}
                className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-sm"
              >
                Limpiar
              </button>
            </div>
          </div>

          {!showGraph ? (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1 text-left">f (×10¹⁴Hz)</th>
                    <th className="px-2 py-1 text-left">λ (nm)</th>
                    <th className="px-2 py-1 text-left">Ef (eV)</th>
                    <th className="px-2 py-1 text-left">Ec (eV)</th>
                    <th className="px-2 py-1 text-left">V (V)</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((m, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-2 py-1">{m.frequency}</td>
                      <td className="px-2 py-1">{m.wavelength}</td>
                      <td className="px-2 py-1">{m.photonEnergy}</td>
                      <td className="px-2 py-1">{m.kineticEnergy}</td>
                      <td className="px-2 py-1">{m.stoppingVoltage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-96 flex flex-col items-center justify-center">
              <svg width="600" height="400" className="border rounded">
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#06B6D4" />
                  </linearGradient>
                </defs>
                
                {/* Grid lines verticales */}
                {Array.from({length: 10}).map((_, i) => (
                  <line
                    key={`vgrid${i}`}
                    x1={40 + i * 60}
                    y1="20"
                    x2={40 + i * 60}
                    y2="380"
                    stroke="#E5E7EB"
                    strokeWidth="1"
                  />
                ))}

                {/* Grid lines horizontales */}
                {Array.from({length: 13}).map((_, i) => (
                  <line
                    key={`hgrid${i}`}
                    x1="40"
                    y1={20 + i * 30}
                    x2="580"
                    y2={20 + i * 30}
                    stroke="#E5E7EB"
                    strokeWidth="1"
                  />
                ))}
                
                {/* Ejes principales */}
                <line x1="40" y1="380" x2="580" y2="380" stroke="#374151" strokeWidth="2" />
                <line x1="40" y1="380" x2="40" y2="20" stroke="#374151" strokeWidth="2" />
                
                {/* Etiquetas de los ejes */}
                <text x="310" y="395" textAnchor="middle" fontSize="14" fill="#374151">
                  Frecuencia (×10¹⁴ Hz)
                </text>
                <text x="25" y="200" textAnchor="middle" fontSize="14" fill="#374151" transform="rotate(-90 25 200)">
                  Ec (eV)
                </text>
                
                {/* Función trabajo */}
                <line 
                  x1="40" 
                  y1={380 - workFunction * 30} 
                  x2="580" 
                  y2={380 - workFunction * 30} 
                  stroke="#EF4444" 
                  strokeWidth="2" 
                  strokeDasharray="5,5"
                />
                
                {/* Puntos de datos */}
                {measurements.map((m, i) => (
                  <circle
                    key={i}
                    cx={40 + (m.frequency - 3) * 53.33}
                    cy={380 - parseFloat(m.kineticEnergy) * 30}
                    r="4"
                    fill="url(#gradient)"
                  />
                ))}
                
                {/* Línea de tendencia */}
                {measurements.length > 1 && (
                  <polyline
                    points={measurements
                      .filter(m => parseFloat(m.kineticEnergy) > 0)
                      .map(m => `${40 + (m.frequency - 3) * 53.33},${380 - parseFloat(m.kineticEnergy) * 30}`)
                      .join(' ')}
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth="2"
                  />
                )}
              </svg>
              
              {/* Ecuación de linealización */}
              <div className="mt-4 text-sm text-gray-700 font-mono bg-gray-50 p-2 rounded">
                <span>E</span>
                <sub>c</sub>
                <span> = h·f - φ = </span>
                <span>{h.toExponential(3)}</span>
                <span>·f - </span>
                <span>{workFunction.toFixed(2)}</span>
                <span> eV</span>
              </div>
            </div>
          )}
        </div>

        {/* Información teórica */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Información Teórica</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Ecuación de Einstein</h3>
              <div className="bg-gray-50 p-4 rounded-lg font-mono text-sm">
                E<sub>cinética</sub> = hf - φ
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Donde h es la constante de Planck, f la frecuencia de la luz, y φ la función trabajo del metal.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-medium mb-2">Observaciones Clave</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• La emisión depende de la frecuencia, no de la intensidad</li>
                <li>• Existe una frecuencia umbral mínima para cada metal</li>
                <li>• La intensidad afecta el número de electrones emitidos</li>
                <li>• La energía cinética máxima es independiente de la intensidad</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoelectricSimulator;