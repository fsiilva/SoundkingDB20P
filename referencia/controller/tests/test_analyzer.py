"""Testes do analisador de frequência (matemática de EQ real + espectro simulado
rotulado + sugestões consultivas)."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skdmc import analyzer


class TestAnalyzer(unittest.TestCase):
    def test_eq_curve_boost_and_cut(self):
        c = analyzer.eq_curve([{"fc": 100, "gain": 6, "q": 1.0},
                               {"fc": 5000, "gain": -6, "q": 1.0}])
        near100 = [d for f, d in c if 80 <= f <= 130]
        near5k = [d for f, d in c if 4000 <= f <= 6000]
        self.assertTrue(max(near100) > 1.0)      # realce no grave
        self.assertTrue(min(near5k) < -1.0)      # corte no agudo

    def test_eq_bypass_is_flat(self):
        c = analyzer.eq_curve([{"fc": 1000, "gain": 9, "q": 1.0, "bypass": True}])
        self.assertTrue(all(abs(d) < 0.01 for _, d in c))

    def test_spectrum_is_labeled_simulated(self):
        s = analyzer.simulated_spectrum()
        self.assertTrue(s["_simulado"])
        self.assertGreater(len(s["pontos"]), 10)

    def test_band_energy_regions(self):
        s = analyzer.simulated_spectrum(seed=3)
        e = analyzer.band_energy(s["pontos"])
        self.assertEqual(set(e.keys()), {"graves", "médios", "agudos"})

    def test_suggestions_are_consultative(self):
        s = analyzer.simulated_spectrum(seed=1)
        out = analyzer.suggestions(s["pontos"], objetivo="inteligibilidade_voz")
        self.assertIn("CONSULTIVAS", out["_aviso"])
        self.assertTrue(all(x["status"] == "sugerido" and x["_hipotese"]
                            for x in out["sugestoes"]))
        self.assertTrue(any("voz" in x["objetivo"].lower() for x in out["sugestoes"]))


if __name__ == "__main__":
    unittest.main()
