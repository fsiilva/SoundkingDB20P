"""Trava a tabela de fidelidade ao descritor REAL: todo item marcado como
'CONFIRMADO (campo existe)' precisa de fato existir no descritor; itens
PROVÁVEL/DESCONHECIDO não podem alegar existência de campo. Também confirma que
o 'mute de bus' NÃO é apresentado como botão de controle funcional."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tools_fidelity


class TestFidelity(unittest.TestCase):
    def setUp(self):
        self.rows = tools_fidelity.classify()

    def test_confirmed_fields_really_exist(self):
        for d in self.rows:
            if str(d["nivel"]).startswith("CONFIRMADO"):
                self.assertTrue(d["campo_existe_no_descritor"],
                                f"Marcado CONFIRMADO mas campo não existe: {d['controle']} / {d['campo']}")

    def test_unknown_not_overclaimed(self):
        # itens DESCONHECIDO/ PROVÁVEL não devem afirmar que o campo existe
        for d in self.rows:
            if d["nivel"] in ("DESCONHECIDO", "PROVÁVEL"):
                self.assertIn(d["campo_existe_no_descritor"], (None, False),
                              f"{d['controle']} rotulado {d['nivel']} mas marca campo existente")

    def test_meter_and_spectrum_are_unknown(self):
        niveis = {d["controle"]: d["nivel"] for d in self.rows}
        self.assertEqual(niveis["Espectro de frequência"], "DESCONHECIDO")
        self.assertEqual(niveis["moduleId → canal/parâmetro físico"], "DESCONHECIDO")

    def test_bus_mute_not_a_fake_button(self):
        # regressão da falha encontrada na auditoria: bus não pode ter botão .btn.mute
        app = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "ui", "app.js")).read()
        # na função de bus strip, o mute deve ser um chip indicador, não um botão clicável
        bus_section = app[app.index("const busStrip"):app.index("const sends")]
        self.assertNotIn('class="btn mute', bus_section)
        self.assertIn('class="chip', bus_section)


if __name__ == "__main__":
    unittest.main()
