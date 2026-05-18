import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Upload } from 'lucide-react';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundFrequencyStep = (v) => Math.round(v * 10) / 10;

/** Texto claro u oscuro según luminancia relativa WCAG del fondo (#RGB / #RRGGBB) */
const getReadableTextColor = (hex) => {
  if (!hex || typeof hex !== 'string') return '#111827';
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#111827';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.55 ? '#111827' : '#FFFFFF';
};

/** Parsea CSV exportado por esta app (compat. con decimales tipo 6.5e14) → filas medición */
const parseMeasurementsCsv = (rawText) => {
  const text = rawText.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('El archivo está vacío.');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('No hay filas de datos además del encabezado.');

  const parseFreq = (cell) => {
    const s = String(cell).trim().toLowerCase().replace(/\s/g, '');
    if (s.includes('e14')) {
      return parseFloat(s.replace(/e14.*$/i, ''));
    }
    const n = parseFloat(s);
    return Number.isNaN(n) ? NaN : n;
  };

  const rows = [];
  for (let idx = 1; idx < lines.length; idx++) {
    const parts = lines[idx].split(',');
    if (parts.length < 7) continue;
    const freq = parseFreq(parts[0]);
    if (Number.isNaN(freq)) continue;
    const metalSym = String(parts[5]).trim();
    const emitsStr = String(parts[6]).trim().toLowerCase();
    const emitsElectrons =
      emitsStr === 'true' || emitsStr === '1' || emitsStr === 'sí' || emitsStr === 'si';

    rows.push({
      id: `import-${Date.now()}-${idx}`,
      frequency: roundFrequencyStep(clamp(freq, FREQ_MIN, FREQ_MAX)),
      wavelength: String(parts[1]).trim(),
      photonEnergy: String(parts[2]).trim(),
      kineticEnergy: String(parts[3]).trim(),
      stoppingVoltage: String(parts[4]).trim(),
      metal: metalSym,
      emitsElectrons,
    });
  }

  if (rows.length === 0) throw new Error('No se pudo interpretar ninguna fila válida.');
  return rows;
};

const FREQ_MIN = 3;
const FREQ_MAX = 12;
const INT_MIN = 10;
const INT_MAX = 100;

/** Posición del tubo en la escena y ánodo alineado al extremo derecho del PNG */
const SIM_TUBE_LEFT = 140;
const SIM_TUBE_WIDTH = 520;
const SIM_ANODE_WIDTH = 16;
const SIM_ANODE_LEFT =
  SIM_TUBE_LEFT + SIM_TUBE_WIDTH - SIM_ANODE_WIDTH - 74;
const SIM_ELECTRON_ABSORB_X = SIM_ANODE_LEFT - 12;

const PhotoelectricSimulator = () => {
  // Estados principales
  const [frequency, setFrequency] = useState(6.0); // x10^14 Hz
  const [intensity, setIntensity] = useState(50); // %
  const [selectedMetal, setSelectedMetal] = useState('Na');
  const [isRunning, setIsRunning] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [showGraph, setShowGraph] = useState(false);
  const [photons, setPhotons] = useState([]); // Agregar este nuevo estado
  const [electrons, setElectrons] = useState([]);

  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const importCsvInputRef = useRef(null);

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

  const addExperimentalNoise = (value) => {
    const noise = value * (1 + (Math.random() - 0.5) * 0.04);
    return Math.max(0, noise);
  };

  const buildMeasurementSnapshot = (fX1e14Hz, metalKey, measurementId) => {
    const fRounded = roundFrequencyStep(clamp(fX1e14Hz, FREQ_MIN, FREQ_MAX));
    const wf = metals[metalKey].workFunction;
    const photonE = h * fRounded * 1e14;
    const maxEcRaw = Math.max(0, photonE - wf);
    const wl = (c / (fRounded * 1e14)) * 1e9;
    const kineticEnergyMeas = addExperimentalNoise(maxEcRaw);
    const photonEnergyMeas = addExperimentalNoise(photonE);
    return {
      id: measurementId ?? `${Date.now()}-${Math.random()}`,
      frequency: fRounded,
      wavelength: wl.toFixed(1),
      photonEnergy: photonEnergyMeas.toFixed(3),
      kineticEnergy: kineticEnergyMeas.toFixed(3),
      stoppingVoltage: kineticEnergyMeas.toFixed(3),
      metal: metalKey,
      emitsElectrons: photonE > wf,
    };
  };

  const enumerateSweepFrequencies = () => {
    const freqs = [];
    for (
      let k = Math.round(FREQ_MIN * 10);
      k <= Math.round(FREQ_MAX * 10);
      k += 1
    ) {
      freqs.push(roundFrequencyStep(k / 10));
    }
    return freqs;
  };

  const runFrequencySweep = () => {
    if (measurements.length > 0) {
      const ok = window.confirm(
        'Se reemplazarán las mediciones actuales. ¿Continuar?'
      );
      if (!ok) return;
    }
    const baseTs = Date.now();
    const freqs = enumerateSweepFrequencies();
    const rows = freqs.map((f, i) =>
      buildMeasurementSnapshot(f, selectedMetal, `sweep-${baseTs}-${i}-${Math.random()}`)
    );
    setMeasurements(rows);
    setFrequency(FREQ_MAX);
  };

  const handleFrequencyInputChange = (e) => {
    const raw = parseFloat(e.target.value);
    if (Number.isNaN(raw)) return;
    setFrequency(roundFrequencyStep(clamp(raw, FREQ_MIN, FREQ_MAX)));
  };

  const handleFrequencyBlur = () => {
    setFrequency(roundFrequencyStep(clamp(frequency, FREQ_MIN, FREQ_MAX)));
  };

  const handleIntensityInputChange = (e) => {
    const raw = parseInt(e.target.value, 10);
    if (Number.isNaN(raw)) return;
    setIntensity(Math.round(clamp(raw, INT_MIN, INT_MAX)));
  };

  const handleIntensityBlur = () => {
    setIntensity(Math.round(clamp(intensity, INT_MIN, INT_MAX)));
  };

  const numberInputBaseClass =
    'w-24 shrink-0 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';

  // Animación de electrones
  useEffect(() => {
    if (!isRunning || !canEmitElectrons) {
      return;
    }

    const animate = () => {
      setElectrons(prev => {
        let newElectrons = [...prev];

        // Agregar nuevos electrones basado en la intensidad
        if (Math.random() < intensity / 1000) {
          const speed = Math.sqrt(maxKineticEnergy) * 20;
          newElectrons.push({
            id: generateId(),
            x: 230, // Posición del cátodo
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
            x: e.x + e.vx, // Mover hacia la derecha
            y: e.y + e.vy,
            life: e.life - 1
          }))
          .filter(
            e =>
              e.life > 0 &&
              e.x >= 190 &&
              e.x <= SIM_TUBE_LEFT + SIM_TUBE_WIDTH + 20 && // Tubo + margen
              e.y >= 200 && e.y <= 300   // Limitar verticalmente al tubo
          );

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

  // Estado para electrones emitidos
const [emittedElectrons, setEmittedElectrons] = useState([]);

// Animación de fotones y emisión de electrones
useEffect(() => {
  let animationFrameId;

  if (!isRunning) {
    setPhotons([]);
    setEmittedElectrons([]);
    return;
  }

  const animate = () => {
    setPhotons(prevPhotons => {
      let newPhotons = [...prevPhotons];

      // Agregar nuevos fotones
      if (Math.random() < intensity / 500) {
        newPhotons.push({
          id: generateId(),
          x: 20,
          y: 250,
          speed: 8
        });
      }

      // Mover fotones y eliminar los que ya no son visibles
      newPhotons = newPhotons
        .map(p => ({
          ...p,
          x: p.x + p.speed
        }))
        .filter(p => p.x < 230 && p.x > 0); // Elimina los que salen del área

      // Limitar el número máximo de fotones en el array
      if (newPhotons.length > 100) {
        newPhotons = newPhotons.slice(newPhotons.length - 100);
      }

      // Emisión de electrón si el fotón llega al cátodo y la frecuencia es suficiente
      newPhotons.forEach(p => {
        if (p.x + p.speed >= 230 && canEmitElectrons) {
          setEmittedElectrons(prev => [
            ...prev,
            {
              id: generateId(),
              x: 230,
              y: 250,
              speed: 10,
              life: 100
            }
          ]);
        }
      });

      return newPhotons;
    });

    // Mover electrones emitidos en línea recta hacia el ánodo
    setEmittedElectrons(prevElectrons =>
      prevElectrons
        .map(e => ({
          ...e,
          x: e.x + e.speed,
          life: e.life - 1
        }))
        .filter(e => e.x < SIM_ELECTRON_ABSORB_X && e.life > 0) // Hasta el colector junto al tubo
    );

    animationFrameId = requestAnimationFrame(animate);
  };

  animationFrameId = requestAnimationFrame(animate);

  return () => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    setPhotons([]); // Limpia los fotones al detener
    setEmittedElectrons([]); // Limpia los electrones emitidos al detener
  };
}, [isRunning, intensity, canEmitElectrons]);

  // Animación de fotones
  useEffect(() => {
    let animationFrameId;

    if (!isRunning) {
      setPhotons([]);
      return;
    }

    const animatePhotons = () => {
      setPhotons(prev => {
        let newPhotons = [...prev];
        
        // Agregar nuevos fotones basado en la intensidad
        if (Math.random() < intensity / 500) {
          const y = 250; // Posición fija en y para trayectoria recta
          newPhotons.push({
            id: generateId(),
            x: 20,
            y: y,
            speed: 8 + Math.random() * 2
          });
        }
        
        // Actualizar posición y eliminar fotones antiguos
        newPhotons = newPhotons
          .map(p => ({
            ...p,
            x: p.x + p.speed
          }))
          .filter(p => p.x < 240);
        
        return newPhotons;
      });
    
      animationFrameId = requestAnimationFrame(animatePhotons);
    };
    
    animationFrameId = requestAnimationFrame(animatePhotons);
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      // No limpies aquí los arrays de estado
      // setPhotons([]);
    };
  }, [isRunning, intensity]);

  const recordMeasurement = () => {
    const row = buildMeasurementSnapshot(frequency, selectedMetal);
    setMeasurements((prev) => [...prev, row]);
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
        `${m.frequency}e14,${m.wavelength},${m.photonEnergy},${m.kineticEnergy},${m.stoppingVoltage},${m.metal},${m.emitsElectrones}`
      ).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "efecto_fotoelectrico_datos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCsvClick = () => {
    importCsvInputRef.current?.click();
  };

  const handleImportCsvChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (measurements.length > 0) {
      const ok = window.confirm(
        'Las mediciones actuales se reemplazarán por las del archivo. ¿Continuar?'
      );
      if (!ok) return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseMeasurementsCsv(String(reader.result));
        setMeasurements(rows);
        const first = rows[0]?.metal;
        if (first && metals[first]) {
          setSelectedMetal(first);
        }
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'No se pudieron cargar los datos.'
        );
      }
    };
    reader.onerror = () => window.alert('No se pudo leer el archivo.');
    reader.readAsText(file, 'UTF-8');
  };

  // When creating a new electron or photon, generate a stable id:
const generateId = (() => {
  let count = 0;
  return () => ++count;
})();

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
        Simulador del Efecto Fotoeléctrico
      </h1>
      
      {/* Contenedor principal con nuevo layout */}
      <div className="flex flex-col gap-6">
        {/* Fila superior con controles y simulación */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Panel de Control (2 columnas de 5) */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Panel de Control</h2>
            
            {/* Frecuencia */}
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 text-sm font-medium text-gray-600">
                <span>Frecuencia:</span>
                <input
                  id="frequency-input"
                  type="number"
                  min={FREQ_MIN}
                  max={FREQ_MAX}
                  step="0.1"
                  value={frequency}
                  onChange={handleFrequencyInputChange}
                  onBlur={handleFrequencyBlur}
                  className={numberInputBaseClass}
                  aria-label="Frecuencia en ×10¹⁴ Hz"
                />
                <span>× 10¹⁴ Hz</span>
              </div>
              <input
                type="range"
                min={FREQ_MIN}
                max={FREQ_MAX}
                step="0.1"
                value={frequency}
                onChange={(e) =>
                  setFrequency(roundFrequencyStep(parseFloat(e.target.value)))
                }
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                aria-label="Frecuencia (deslizador)"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>IR</span>
                <span>Visible</span>
                <span>UV</span>
              </div>
            </div>

            {/* Intensidad */}
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 text-sm font-medium text-gray-600">
                <span>Intensidad:</span>
                <input
                  id="intensity-input"
                  type="number"
                  min={INT_MIN}
                  max={INT_MAX}
                  step="1"
                  value={intensity}
                  onChange={handleIntensityInputChange}
                  onBlur={handleIntensityBlur}
                  className={numberInputBaseClass}
                  aria-label="Intensidad en porcentaje"
                />
                <span>%</span>
              </div>
              <input
                type="range"
                min={INT_MIN}
                max={INT_MAX}
                step="1"
                value={intensity}
                onChange={(e) => setIntensity(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                aria-label="Intensidad (deslizador)"
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
                className="w-full px-3 py-2 rounded-md border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-50 border-black/15"
                style={{
                  backgroundColor: metals[selectedMetal].color,
                  color: getReadableTextColor(metals[selectedMetal].color),
                }}
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
                onClick={() => {
                  setIsRunning(false);
                  setPhotons([]); // Limpiar los fotones
                  setElectrons([]); // Limpiar los electrones
                  setEmittedElectrons([]); // Limpiar los electrones emitidos
                }}
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

          {/* Simulación Visual (3 columnas de 5) */}
          <div className="lg:col-span-3 bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Simulación</h2>
            
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ height: '500px' }}>
             
              
              {/* Fuente láser: boquilla alineada con el origen del haz (esquina TR del rectángulo) */}
              <div
                className="absolute pointer-events-none select-none z-[26]"
                style={{ left: '430px', top: '20px' }}
              >
                <img
                  src={`${process.env.PUBLIC_URL || ''}/laser.png`}
                  alt="Fuente láser"
                  className="block max-h-[5rem] w-auto object-contain"
                  style={{
                    transform: 'translateX(-100%) rotate(135deg)',
                    transformOrigin: 'right center',
                  }}
                  draggable={false}
                />
              </div>

              {/* Haz de luz diagonal - extendido hasta el cátodo */}
              {isRunning && (
                <div 
                  className="absolute z-[22] opacity-70 transform -rotate-45 origin-top-right pointer-events-none"
                  style={{ 
                    left: '110px',
                    top: '40px',
                    width: `${410 - 90}px`,
                    height: '30px',
                    backgroundColor: lightColor,
                    boxShadow: `0 0 10px ${lightColor}`
                  }}
                />
              )}

              {/* Fotones */}
              {isRunning && photons.map(photon => {
                // Calcular posición diagonal del fotón (desde arriba derecha hacia el cátodo)
                const diagonalX = 400 - photon.x * Math.cos(Math.PI/4);
                const diagonalY = 90 + photon.x * Math.sin(Math.PI/4);
                
                return (
                  <div
                    key={`photon-${photon.id}`}
                    className="absolute z-[23] pointer-events-none"
                    style={{
                      left: `${diagonalX}px`,
                      top: `${diagonalY}px`,
                      transform: 'translate(-50%, -50%) rotate(-45deg)',
                      color: lightColor,
                    }}
                  >
                    <svg 
                      width="20" 
                      height="10" 
                      viewBox="0 0 12 6" 
                      fill="none" 
                      style={{
                        filter: `drop-shadow(0 0 4px ${lightColor})`
                      }}
                    >
                      <path
                        d="M0 3L8 3L8 5L12 3L8 1L8 3Z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                );
              })}
              {/* Tubo de vacío (imagen) */}
              <img
                src={`${process.env.PUBLIC_URL || ''}/tubovacio.png`}
                alt="Tubo de vacío"
                className="absolute pointer-events-none select-none object-contain z-[10]"
                style={{
                  left: `${SIM_TUBE_LEFT}px`,
                  top: '195px',
                  width: `${SIM_TUBE_WIDTH}px`,
                  height: '112px',
                }}
                draggable={false}
              />

              {/* Superficie metálica (cátodo) - posición central izquierda */}
              <div 
                className="absolute z-[14] w-5 h-20 rounded-lg opacity-20"
                style={{ 
                  left: '230px',
                  top: '210px',
                  backgroundColor: metals[selectedMetal].color,
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.3)'
                }}
              />

              {/* Etiqueta del metal */}
              <div className="absolute z-[24] text-white text-xs" style={{ left: '190px', top: '130px' }}>
                {metals[selectedMetal].name}
                <br />
                φ = {workFunction} eV
              </div>

              {/* Electrones emitidos en línea recta */}
              {emittedElectrons.map(electron => (
                <div
                  key={`emitted-electron-${electron.id}`}
                  className="absolute z-[28]"
                  style={{
                    left: `${electron.x}px`,
                    top: `${electron.y}px`,
                    width: '20px',
                    height: '20px',
                    pointerEvents: 'none',
                    opacity: electron.life / 100
                  }}
                >
                  <svg width="20" height="20">
                    <circle cx="10" cy="10" r="9" fill="#3B82F6" stroke="#1e40af" strokeWidth="2"/>
                    <text x="10" y="14" textAnchor="middle" fontSize="16" fill="#fff" fontWeight="bold">−</text>
                  </svg>
                </div>
              ))}

              {/* Electrones fijos en el cátodo */}
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={`cathode-electron-${i}`}
                  className="absolute z-[14]"
                  style={{
                    left: '230px',
                    top: `${215 + i * 12}px`,
                    width: '10px',
                    height: '10px',
                    pointerEvents: 'none'
                  }}
                >
                  <svg width="20" height="20">
                    <circle cx="10" cy="10" r="7" fill="#3B82F6" stroke="#1e40af" strokeWidth="2"/>
                    <text x="10" y="14" textAnchor="middle" fontSize="16" fill="#fff" fontWeight="bold">−</text>
                  </svg>
                </div>
              ))}

              {/* Colector/Ánodo — alineado al extremo derecho del tubo (png) */}
              <div
                className="absolute top-1/2 z-[14] -translate-y-1/2 bg-gray-600 rounded-r-lg opacity-20"
                style={{
                  left: `${SIM_ANODE_LEFT}px`,
                  width: `${SIM_ANODE_WIDTH}px`,
                  height: '80px',
                }}
              />

              {/* Voltímetro */}
              <div className="absolute bottom-4 left-4 z-[40] bg-gray-800 text-white px-3 py-2 rounded text-sm">
                <div>V = {stoppingVoltage.toFixed(3)} V</div>
                <div>Ec = {maxKineticEnergy.toFixed(3)} eV</div>
              </div>

              {/* Indicador de emisión */}
              <div className="absolute top-4 right-4 z-[40]">
                <div className={`w-4 h-4 rounded-full ${canEmitElectrons ? 'bg-green-500' : 'bg-red-500'}`} />
                <div className="text-white text-xs mt-1">
                  {canEmitElectrons ? 'Emitiendo' : 'Sin emisión'}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-4">
              <button
                type="button"
                onClick={recordMeasurement}
                className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-medium"
              >
                Registrar Medición
              </button>
              <button
                type="button"
                onClick={runFrequencySweep}
                className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium text-sm"
              >
                Barrido automático ({FREQ_MIN}–{FREQ_MAX} ×10¹⁴ Hz, paso 0.1)
              </button>
            </div>
          </div>
        </div>


        {/* Panel de Mediciones */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-700">Mediciones</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={importCsvInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={handleImportCsvChange}
              />
              <button
                type="button"
                onClick={() => setShowGraph(!showGraph)}
                className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm"
              >
                {showGraph ? 'Tabla' : 'Gráfica'}
              </button>
              <button
                type="button"
                onClick={exportData}
                className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-sm disabled:opacity-50"
                disabled={measurements.length === 0}
                title="Descargar mediciones como CSV"
                aria-label="Descargar mediciones como CSV"
              >
                <Download size={14} aria-hidden />
              </button>
              <button
                type="button"
                onClick={handleImportCsvClick}
                className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded text-sm"
                title="Cargar CSV (mismo formato que la exportación de esta aplicación)"
                aria-label="Cargar mediciones desde archivo CSV"
              >
                <Upload size={14} aria-hidden />
              </button>
              <button
                type="button"
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
                    <tr key={`measurement-${i}-${m.frequency}`} className="border-b">
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
            <div className="h-[500px] flex flex-col items-center justify-center overflow-visible">
  <svg width="650" height="460" className="border rounded" viewBox="0 0 650 460">
    <defs>
      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8B5CF6" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
    </defs>
    
    {/* Grid lines verticales */}
    {Array.from({length: 10}).map((_, i) => (
      <line
        key={`vgrid-${i}`}
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
        key={`hgrid-${i}`}
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
    
    {/* Marcas y etiquetas del eje X */}
    {Array.from({length: 10}).map((_, i) => {
      const frequency = 3 + i * 0.5; // Valores de frecuencia de 3.0 a 7.5
      const x = 40 + i * 60;
      return (
        <g key={`x-axis-${i}`}>
          {/* Marca del eje */}
          <line
            x1={x}
            y1="380"
            x2={x}
            y2="385"
            stroke="#374151"
            strokeWidth="2"
          />
          {/* Etiqueta numérica */}
          <text
            x={x}
            y="405"
            textAnchor="middle"
            fontSize="12"
            fill="#374151"
          >
            {frequency.toFixed(1)}
          </text>
        </g>
      );
    })}
    
    {/* Marcas y etiquetas del eje Y */}
    {Array.from({length: 13}).map((_, i) => {
      const energy = i * 0.5; // Valores de energía de 0 a 6
      const y = 380 - i * 30;
      return (
        <g key={`y-axis-${i}`}>
          {/* Marca del eje */}
          <line
            x1="35"
            y1={y}
            x2="40"
            y2={y}
            stroke="#374151"
            strokeWidth="2"
          />
          {/* Etiqueta numérica */}
          <text
            x="30"
            y={y + 4}
            textAnchor="end"
            fontSize="12"
            fill="#374151"
          >
            {energy.toFixed(1)}
          </text>
        </g>
      );
    })}
    
    {/* Etiquetas de los ejes */}
    <text x="325" y="430" textAnchor="middle" fontSize="14" fill="#374151" fontWeight="bold">
      Frecuencia (×10¹⁴ Hz)
    </text>
    <text x="20" y="200" textAnchor="middle" fontSize="14" fill="#374151" fontWeight="bold" transform="rotate(-90 20 210)">
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
        key={`point-${i}-${m.frequency}`}
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