import json
import os
import random
from dataclasses import dataclass
from typing import Dict, List, Tuple

import pygame


WIDTH = 960
HEIGHT = 540
FPS = 60

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


@dataclass
class Player:
    x: float
    y: float
    w: int = 20
    h: int = 20
    speed: float = 180.0
    hp: int = 50
    attack: int = 5
    class_id: str = ""


@dataclass
class Enemy:
    x: float
    y: float
    hp: int
    attack: int
    w: int = 18
    h: int = 18


class Game:
    def __init__(self) -> None:
        pygame.init()
        pygame.display.set_caption("Pixel Dungeons (Prototype)")
        self.screen = pygame.display.set_mode((WIDTH, HEIGHT))
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont(None, 22)

        self.classes = self._load_json("classes.json")
        self.items = self._load_json("items.json")
        self.loot_tables = self._load_json("loot_tables.json")
        self.dungeons = self._load_json("dungeons.json")

        self.player = Player(x=WIDTH / 2, y=HEIGHT / 2)
        self.current_dungeon_id = ""
        self.current_enemies: List[Enemy] = []
        self.loot_log: List[str] = []
        self.info_log: List[str] = ["Press R to spin class", "Press Enter to start dungeon"]

    def _load_json(self, filename: str) -> Dict:
        path = os.path.join(DATA_DIR, filename)
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def run(self) -> None:
        running = True
        while running:
            dt = self.clock.tick(FPS) / 1000.0
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        running = False
                    elif event.key == pygame.K_r:
                        self.spin_class()
                    elif event.key == pygame.K_RETURN:
                        self.start_dungeon("dungeon_1")

            self.handle_input(dt)
            self.update(dt)
            self.draw()

        pygame.quit()

    def spin_class(self) -> None:
        spin_table = self.classes["spin_table"]
        class_id = self.weighted_choice([(e["class_id"], e["weight"]) for e in spin_table])
        self.player.class_id = class_id
        class_name = self.classes["classes"][class_id]["name"]
        self.info_log.append(f"Spun class: {class_name}")

    def start_dungeon(self, dungeon_id: str) -> None:
        self.current_dungeon_id = dungeon_id
        self.current_enemies = []
        self.spawn_enemies(5)
        self.info_log.append(f"Entered {self.dungeons['dungeons'][dungeon_id]['name']}")

    def spawn_enemies(self, count: int) -> None:
        enemy_table_id = self.dungeons["dungeons"]["dungeon_1"]["enemy_table_id"]
        table = self.dungeons["enemy_tables"][enemy_table_id]
        for _ in range(count):
            enemy_id = self.weighted_choice([(e["enemy_id"], e["weight"]) for e in table])
            data = self.dungeons["enemies"][enemy_id]
            x = random.randint(50, WIDTH - 50)
            y = random.randint(50, HEIGHT - 50)
            self.current_enemies.append(Enemy(x=x, y=y, hp=data["hp"], attack=data["attack"]))

    def handle_input(self, dt: float) -> None:
        keys = pygame.key.get_pressed()
        dx = (keys[pygame.K_d] or keys[pygame.K_RIGHT]) - (keys[pygame.K_a] or keys[pygame.K_LEFT])
        dy = (keys[pygame.K_s] or keys[pygame.K_DOWN]) - (keys[pygame.K_w] or keys[pygame.K_UP])
        if dx or dy:
            length = (dx * dx + dy * dy) ** 0.5
            dx = dx / length if length else 0
            dy = dy / length if length else 0
            self.player.x += dx * self.player.speed * dt
            self.player.y += dy * self.player.speed * dt

            self.player.x = max(0, min(WIDTH - self.player.w, self.player.x))
            self.player.y = max(0, min(HEIGHT - self.player.h, self.player.y))

    def update(self, dt: float) -> None:
        # Simple combat: touching an enemy damages it; enemy damages player
        player_rect = pygame.Rect(self.player.x, self.player.y, self.player.w, self.player.h)
        remaining = []
        for enemy in self.current_enemies:
            enemy_rect = pygame.Rect(enemy.x, enemy.y, enemy.w, enemy.h)
            if player_rect.colliderect(enemy_rect):
                enemy.hp -= self.player.attack
                self.player.hp -= enemy.attack
                if enemy.hp <= 0:
                    self.drop_loot()
                    continue
            remaining.append(enemy)
        self.current_enemies = remaining

    def drop_loot(self) -> None:
        if not self.current_dungeon_id:
            return
        table_id = self.dungeons["dungeons"][self.current_dungeon_id]["loot_table_id"]
        entries = self.loot_tables["tables"][table_id]

        class_tags = []
        if self.player.class_id:
            class_tags = self.classes["classes"][self.player.class_id]["loot_affinity_tags"]

        weighted_entries: List[Tuple[str, float]] = []
        for entry in entries:
            weight = entry["weight"]
            if class_tags and any(tag in class_tags for tag in entry.get("tags", [])):
                weight *= 1.5
            weighted_entries.append((entry["item_id"], weight))

        item_id = self.weighted_choice(weighted_entries)
        item = self.items["items"][item_id]
        self.loot_log.append(f"Loot: {item['name']}")
        if len(self.loot_log) > 6:
            self.loot_log = self.loot_log[-6:]

    @staticmethod
    def weighted_choice(entries: List[Tuple[str, float]]) -> str:
        total = sum(weight for _, weight in entries)
        roll = random.uniform(0, total)
        upto = 0.0
        for item_id, weight in entries:
            upto += weight
            if roll <= upto:
                return item_id
        return entries[-1][0]

    def draw(self) -> None:
        self.screen.fill((20, 18, 24))

        # Player
        pygame.draw.rect(self.screen, (70, 200, 90), (self.player.x, self.player.y, self.player.w, self.player.h))

        # Enemies
        for enemy in self.current_enemies:
            pygame.draw.rect(self.screen, (200, 60, 60), (enemy.x, enemy.y, enemy.w, enemy.h))

        # HUD
        hud_lines = [
            f"HP: {self.player.hp}",
            f"Class: {self.player.class_id or 'None'}",
            f"Dungeon: {self.current_dungeon_id or 'None'}",
        ]

        self._draw_text_block(10, 10, hud_lines)
        self._draw_text_block(10, 90, self.info_log[-4:])
        self._draw_text_block(10, 170, self.loot_log)

        pygame.display.flip()

    def _draw_text_block(self, x: int, y: int, lines: List[str]) -> None:
        offset = 0
        for line in lines:
            surf = self.font.render(line, True, (230, 230, 230))
            self.screen.blit(surf, (x, y + offset))
            offset += 20
